const { z } = require("zod");
const schema = z.object({ name: z.string(), age: z.number() });
function firstIssue(data) {
  const r = schema.safeParse(data);
  if (r.success) return null;
  return r.error.errors[0].message;
}
module.exports = { firstIssue };
