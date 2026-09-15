export default {
  async "content.beforeCreate"(content) {
    if (content.excerpt?.trim()) return { allow: true };
    const plain = String(content.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return { allow: true, patch: { excerpt: plain.slice(0, 155) } };
  }
};
