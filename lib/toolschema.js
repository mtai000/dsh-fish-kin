/**
 * toolschema.js —— 简写参数表 → 标准 JSON Schema
 *
 * provider 只认 `{ type:'object', properties:{…}, required:[…] }`。
 * 简写（`{ text: { type:'string', required:true } }`）发出去会被拒：
 * "schema must be a JSON Schema of 'type: object'"。
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function prop(spec) {
  if (!isObj(spec)) return { type: 'string' }
  const out = {}
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'required') continue
    if (k === 'items') out.items = prop(v)
    else if (k === 'properties') {
      out.properties = {}
      for (const [pk, pv] of Object.entries(v ?? {})) out.properties[pk] = prop(pv)
    } else out[k] = v
  }
  if (!out.type) out.type = 'string'
  return out
}

export function toJsonSchema(dsl) {
  if (isObj(dsl) && dsl.type === 'object' && isObj(dsl.properties)) return dsl
  const properties = {}
  const required = []
  for (const [name, spec] of Object.entries(isObj(dsl) ? dsl : {})) {
    properties[name] = prop(spec)
    if (isObj(spec) && spec.required === true) required.push(name)
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}
