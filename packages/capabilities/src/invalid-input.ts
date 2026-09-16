import type { z } from 'zod';

type JsonSchema = Record<string, unknown>;

/** After this many invalid calls to one tool in one run, the model stops guessing and asks. */
export const MAX_INVALID_ATTEMPTS = 3;
/** A field's schema is shown in full up to this size; larger ones are summarized. */
const MAX_SCHEMA_CHARS = 3_000;

/** The part of a tool's JSON Schema that an issue's path points at. */
export function schemaAt(schema: JsonSchema, path: readonly PropertyKey[]) {
  let node: JsonSchema | undefined = schema;
  for (const key of path) {
    if (!node) return undefined;
    node =
      typeof key === 'number'
        ? (node.items as JsonSchema | undefined)
        : (node.properties as Record<string, JsonSchema> | undefined)?.[String(key)];
  }
  return node;
}

function valueAt(value: unknown, path: readonly PropertyKey[]) {
  let node = value;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

const brief = (value: unknown) => {
  const text = value === undefined ? 'nothing' : (JSON.stringify(value) ?? String(value));
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
};

/** A schema small enough to send whole; otherwise its shape, which is what a fix needs. */
function compact(schema: JsonSchema) {
  if (JSON.stringify(schema).length <= MAX_SCHEMA_CHARS) return schema;
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  return {
    type: schema.type,
    ...(schema.required ? { required: schema.required } : {}),
    ...(properties
      ? {
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [
              key,
              { type: value.type ?? (value.anyOf || value.oneOf ? 'one of several shapes' : 'any') },
            ]),
          ),
        }
      : {}),
  };
}

/** One line for people: the first thing that was wrong, and where. */
export function describeIssue(issue: z.core.$ZodIssue) {
  const where = issue.path.length ? issue.path.join('.') : 'input';
  return `${where}: ${issue.message.replace(/^Invalid input:\s*/, '')}`;
}

/**
 * What the model gets back when its input doesn't fit: for each problem, the field, what it
 * sent, and the exact JSON Schema that field expects, so the next call can be right rather
 * than another guess. After a few failed attempts it is told to stop and ask the person.
 */
export function invalidInputGuide(
  tool: string,
  schema: JsonSchema,
  issues: readonly z.core.$ZodIssue[],
  raw: unknown,
  attempt: number,
) {
  return {
    error: 'invalid_input',
    attempt,
    problems: issues.slice(0, 5).map(issue => ({
      field: issue.path.length ? issue.path.join('.') : '(the whole input)',
      problem: issue.message,
      sent: brief(valueAt(raw, issue.path)),
      expected: compact(schemaAt(schema, issue.path) ?? schema),
    })),
    next:
      attempt >= MAX_INVALID_ATTEMPTS
        ? `That is ${attempt} invalid calls to ${tool}. Do not call it again in this reply: tell ` +
          'the user in one sentence what you were trying to do and ask them to confirm the details.'
        : `Call ${tool} again with the same values, changing only the fields in "problems" so each ` +
          'matches its "expected" JSON Schema exactly: the same property names, types and literal ' +
          'values (for example a required "kind"). Do not retry the same shape.',
  };
}
