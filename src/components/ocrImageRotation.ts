export function getImageRotationTransform(rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360;

  if (normalized === 90) return "rotate(90deg) translateY(-100%)";
  if (normalized === 180) return "rotate(180deg) translate(-100%, -100%)";
  if (normalized === 270) return "rotate(270deg) translateX(-100%)";
  return "none";
}

export function centerImagePreview(node: HTMLElement | null) {
  if (!node) return;

  window.requestAnimationFrame(() => {
    node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
    node.scrollTop = Math.max(0, (node.scrollHeight - node.clientHeight) / 2);
  });
}
