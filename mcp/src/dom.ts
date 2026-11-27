/**
 * DOM XML para o motor fiscal local rodar no Node.
 *
 * O motor de `frontend/src/lib/localProcessing` foi escrito para o navegador e
 * usa `DOMParser`/`XMLSerializer` globais. No Node eles não existem; este
 * módulo instala uma implementação baseada em `@xmldom/xmldom` (parser XML
 * completo, com namespaces) e acrescenta somente o que o motor usa além do
 * que o xmldom oferece:
 *
 * - `querySelector`/`querySelectorAll` com seletores `*` ou nome de tag;
 * - erro de leitura devolvido como documento `<parsererror>`, como no navegador,
 *   em vez de exceção — o motor verifica `doc.querySelector('parsererror')`.
 *
 * Nenhuma mensagem é escrita em stdout: no transporte stdio do MCP o stdout é
 * o canal do protocolo.
 */
import {
  DOMParser as XmldomParser,
  XMLSerializer as XmldomSerializer,
  onErrorStopParsing,
} from '@xmldom/xmldom';

type AnyNode = {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  childNodes?: ArrayLike<AnyNode>;
};

const ELEMENT_NODE = 1;

function collectDescendants(root: AnyNode, matches: (node: AnyNode) => boolean, firstOnly: boolean): AnyNode[] {
  const found: AnyNode[] = [];
  const stack: AnyNode[] = [];
  const pushChildren = (node: AnyNode) => {
    const children = node.childNodes;
    if (!children) return;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  };
  pushChildren(root);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === ELEMENT_NODE) {
      if (matches(node)) {
        found.push(node);
        if (firstOnly) return found;
      }
      pushChildren(node);
    }
  }
  return found;
}

function selectorMatcher(selector: string): (node: AnyNode) => boolean {
  const target = selector.trim();
  if (target === '*') return () => true;
  if (!/^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/.test(target)) {
    throw new Error(`Seletor não suportado no DOM do servidor MCP: "${selector}".`);
  }
  return (node) => node.nodeName === target || node.localName === target;
}

function installSelectors(proto: object): void {
  if (!('querySelectorAll' in proto)) {
    Object.defineProperty(proto, 'querySelectorAll', {
      configurable: true,
      writable: true,
      value(this: AnyNode, selector: string) {
        return collectDescendants(this, selectorMatcher(selector), false);
      },
    });
  }
  if (!('querySelector' in proto)) {
    Object.defineProperty(proto, 'querySelector', {
      configurable: true,
      writable: true,
      value(this: AnyNode, selector: string) {
        return collectDescendants(this, selectorMatcher(selector), true)[0] ?? null;
      },
    });
  }
}

function installChildren(proto: object): void {
  if ('children' in proto) return;
  Object.defineProperty(proto, 'children', {
    configurable: true,
    get(this: AnyNode) {
      return Array.from(this.childNodes ?? []).filter((node) => node.nodeType === ELEMENT_NODE);
    },
  });
}

let prototypesPatched = false;

function patchPrototypes(): void {
  if (prototypesPatched) return;
  const probe = new XmldomParser().parseFromString('<a><b/></a>', 'application/xml');
  const documentProto = Object.getPrototypeOf(probe);
  const elementProto = Object.getPrototypeOf(probe.documentElement);
  installSelectors(documentProto);
  installSelectors(elementProto);
  installChildren(documentProto);
  installChildren(elementProto);
  prototypesPatched = true;
}

function parserErrorDocument(message: string) {
  // Igual ao navegador: o erro vira um documento com <parsererror>, e quem
  // chamou decide a mensagem para o usuário.
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return new XmldomParser().parseFromString(`<parsererror>${escaped}</parsererror>`, 'application/xml');
}

export class NodeDOMParser {
  parseFromString(text: string, mimeType: string) {
    patchPrototypes();
    try {
      const parser = new XmldomParser({ onError: onErrorStopParsing });
      return parser.parseFromString(text, (mimeType || 'application/xml') as 'application/xml');
    } catch (error) {
      return parserErrorDocument(error instanceof Error ? error.message : String(error));
    }
  }
}

export class NodeXMLSerializer {
  serializeToString(node: unknown): string {
    return new XmldomSerializer().serializeToString(node as never);
  }
}

/** Instala `DOMParser` e `XMLSerializer` globais (idempotente). */
export function installNodeDom(): void {
  patchPrototypes();
  const globals = globalThis as Record<string, unknown>;
  globals.DOMParser = NodeDOMParser;
  globals.XMLSerializer = NodeXMLSerializer;
}
