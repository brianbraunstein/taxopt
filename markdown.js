
class Markdown extends HTMLElement {
  constructor() { super(); }

  connectedCallback() {
    this.div = document.createElement('div');
    this.appendChild(this.div);
    this.run();
  }

  run() {
    const srcId = this.getAttribute("src-id");
    this.div.innerHTML = 
        marked.parse(document.getElementById(srcId).textContent);
  }
}


customElements.define('markdown-inline', Markdown);

