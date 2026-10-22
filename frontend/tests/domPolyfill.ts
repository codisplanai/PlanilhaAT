// Minimal DOMParser polyfill for Node.js test runner environment

class SimpleElement {
  tagName: string;
  localName: string;
  attributes: Map<string, string>;
  children: SimpleElement[] = [];
  textContent: string = '';

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName;
    this.localName = tagName.includes(':') ? tagName.split(':')[1] : tagName;
    this.attributes = new Map(Object.entries(attributes));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild(child: SimpleElement): SimpleElement {
    this.children.push(child);
    return child;
  }

  removeChild(child: SimpleElement): SimpleElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
    }
    return child;
  }

  insertBefore(newNode: SimpleElement, referenceNode: SimpleElement | null): SimpleElement {
    if (!referenceNode) {
      this.children.push(newNode);
      return newNode;
    }
    const idx = this.children.indexOf(referenceNode);
    if (idx === -1) {
      this.children.push(newNode);
    } else {
      this.children.splice(idx, 0, newNode);
    }
    return newNode;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNS(_ns: string, name: string): string | null {
    return this.attributes.get(name) ?? this.attributes.get(`r:${name}`) ?? null;
  }

  getElementsByTagName(name: string): SimpleElement[] {
    const results: SimpleElement[] = [];
    const traverse = (node: SimpleElement) => {
      if (node.tagName === name || node.localName === name) results.push(node);
      for (const child of node.children) traverse(child);
    };
    for (const child of this.children) traverse(child);
    return results;
  }

  getElementsByTagNameNS(_ns: string, localName: string): SimpleElement[] {
    const results: SimpleElement[] = [];
    const traverse = (node: SimpleElement) => {
      if (node.localName === localName) results.push(node);
      for (const child of node.children) traverse(child);
    };
    for (const child of this.children) traverse(child);
    return results;
  }

  querySelectorAll(selector: string): SimpleElement[] {
    const results: SimpleElement[] = [];
    const target = selector.trim();
    const traverse = (node: SimpleElement) => {
      if (target === '*' || node.tagName === target || node.localName === target) {
        results.push(node);
      }
      for (const child of node.children) traverse(child);
    };
    for (const child of this.children) traverse(child);
    return results;
  }

  querySelector(selector: string): SimpleElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class SimpleDocument extends SimpleElement {
  documentElement: SimpleElement;

  constructor(root: SimpleElement) {
    super('#document');
    this.documentElement = root;
    this.children = [root];
  }

  createElementNS(_ns: string, name: string): SimpleElement {
    return new SimpleElement(name);
  }
}

export function installDomParserPolyfill(): void {
  globalThis.DOMParser = class MockDOMParser {
    parseFromString(text: string, _type: string) {
      const clean = text.replace(/<\?xml[\s\S]*?\?>/, '').trim();
      const tokenRegex = /<([a-zA-Z0-9_:]+)([^>]*?)(\/?>)|<\/([a-zA-Z0-9_:]+)>|([^<]+)/g;
      const attrRegex = /([a-zA-Z0-9_:]+)="([^"]*)"/g;

      const stack: SimpleElement[] = [];
      let root: SimpleElement | null = null;

      let match;
      while ((match = tokenRegex.exec(clean)) !== null) {
        const [, openTag, attrsRaw, selfClose, closeTag, textContent] = match;
        if (openTag) {
          const attrs: Record<string, string> = {};
          let aMatch;
          while ((aMatch = attrRegex.exec(attrsRaw)) !== null) {
            attrs[aMatch[1]] = aMatch[2];
          }
          const elem = new SimpleElement(openTag, attrs);
          if (stack.length > 0) {
            stack[stack.length - 1].children.push(elem);
          } else {
            root = elem;
          }
          if (selfClose !== '/>') {
            stack.push(elem);
          }
        } else if (closeTag) {
          if (stack.length > 0 && (stack[stack.length - 1].tagName === closeTag || stack[stack.length - 1].localName === closeTag)) {
            stack.pop();
          }
        } else if (textContent) {
          const trimmed = textContent.trim();
          if (trimmed && stack.length > 0) {
            stack[stack.length - 1].textContent += trimmed;
          }
        }
      }

      return new SimpleDocument(root ?? new SimpleElement('root')) as unknown as XMLDocument;
    }
  } as unknown as typeof DOMParser;

  if (typeof globalThis.XMLSerializer === 'undefined') {
    globalThis.XMLSerializer = class MockXMLSerializer {
      serializeToString(root: SimpleElement): string {
        const serialize = (node: SimpleElement): string => {
          if (node.tagName === '#document') {
            return node.children.map(serialize).join('');
          }
          let attrs = '';
          for (const [k, v] of node.attributes.entries()) {
            attrs += ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
          }
          if (node.children.length === 0 && !node.textContent) {
            return `<${node.tagName}${attrs}/>`;
          }
          let content = '';
          if (node.textContent) {
            content += String(node.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          }
          for (const child of node.children) {
            content += serialize(child);
          }
          return `<${node.tagName}${attrs}>${content}</${node.tagName}>`;
        };
        return serialize(root);
      }
    } as unknown as typeof XMLSerializer;
  }
}
