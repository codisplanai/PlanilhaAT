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
}

export function installDomParserPolyfill(): void {
  if (typeof globalThis.DOMParser !== 'undefined') return;

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
}
