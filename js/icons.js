// Icons come from the <svg> sprite at the top of index.html.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

// Points an existing icon at a different symbol.
export function setIcon(svg, name) {
  svg.querySelector('use').setAttribute('href', `#${name}`);
}
