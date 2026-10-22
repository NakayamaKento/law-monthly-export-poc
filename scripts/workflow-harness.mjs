import assert from 'node:assert/strict';

// Deliberately limited offline WDL interpreter: unsupported syntax fails instead of pretending to validate Azure runtime behavior.
export function expression(source, context) {
  const tokens = source.match(/'(?:[^']|'')*'|[A-Za-z_$][A-Za-z0-9_$]*|-?\d+|[()[\],.?]/g) ?? [];
  let index = 0;
  const take = expected => {
    const value = tokens[index++];
    if (expected) assert.equal(value, expected, source);
    return value;
  };
  function value() {
    const token = take();
    let result;
    if (token.startsWith("'")) result = token.slice(1, -1).replaceAll("''", "'");
    else if (/^-?\d+$/.test(token)) result = Number(token);
    else if (['true', 'false', 'null'].includes(token)) result = JSON.parse(token);
    else {
      take('(');
      const args = [];
      while (tokens[index] !== ')') {
        args.push(value());
        if (tokens[index] !== ',') break;
        take(',');
      }
      take(')');
      assert(Object.hasOwn(context.functions, token), `Unsupported WDL function ${token}`);
      result = context.functions[token](...args);
    }
    while (['?', '[', '.'].includes(tokens[index])) {
      const optional = tokens[index] === '?';
      if (optional) take('?');
      if (tokens[index] === '[') {
        take('[');
        const key = value();
        take(']');
        result = optional ? result?.[key] : result[key];
      } else {
        take('.');
        result = result[take()];
      }
    }
    return result;
  }
  const result = value();
  assert.equal(index, tokens.length, `Unparsed WDL expression ${source}`);
  return result;
}

export function sampleRecords(kql) {
  const rows = [...kql.matchAll(/datetime\(([^)]+)\),(\d+),("(?:\\.|[^"\\])*")/g)];
  assert.equal(rows.length, 6, 'The sample fixture must contain all six boundary/special-character rows');
  return rows.map(([, time, id, text]) => ({
    TimeGenerated: new Date(time).toISOString(),
    Id: Number(id),
    Text: JSON.parse(text),
  }));
}

function validateSchema(value, schema) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type) assert([schema.type].flat().includes(type), `Expected ${schema.type}, received ${type}`);
  if (schema.required) for (const key of schema.required) assert(Object.hasOwn(value, key), `Missing ${key}`);
  if (schema.items) for (const item of value) validateSchema(item, schema.items);
  if (schema.properties) for (const [key, nested] of Object.entries(schema.properties)) {
    if (Object.hasOwn(value, key)) validateSchema(value[key], nested);
  }
}

export function runWorkflow(definition, settings, options = {}) {
  const blobs = options.blobs ?? new Map();
  const outputs = {};
  const bodies = {};
  const trace = [];
  const params = Object.fromEntries(Object.entries(settings).map(([key, setting]) => [key, setting.value]));
  params.$connections = {
    azuremonitorlogs: { connectionId: 'mock-logs' },
    azureblob: { connectionId: 'mock-blob' },
  };
  let item;
  const context = {
    functions: {
      parameters: key => params[key],
      outputs: key => outputs[key],
      body: key => bodies[key],
      workflow: () => ({ run: { name: options.runId ?? 'run-1' } }),
      item: () => item,
      utcNow: () => options.now ?? '2026-03-05T00:00:00Z',
      empty: value => value == null || value === '' || value.length === 0,
      trim: value => value.trim(),
      length: value => value.length,
      union: (...arrays) => [...new Set(arrays.flat())],
      concat: (...values) => values.join(''),
      split: (value, separator) => value.split(separator),
      join: (value, separator) => value.join(separator),
      first: value => value[0],
      substring: (value, start, length) => value.slice(start, start + length),
      decodeUriComponent: decodeURIComponent,
      uriComponentToString: decodeURIComponent,
      encodeURIComponent,
      json: JSON.parse,
      string: value => typeof value === 'string' ? value : JSON.stringify(value),
      base64: value => Buffer.from(value, 'utf8').toString('base64'),
      if: (condition, yes, no) => condition ? yes : no,
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      formatDateTime: (value, format) => {
        const time = new Date(value);
        assert(!Number.isNaN(time.valueOf()), `Invalid datetime ${value}`);
        const date = time.toISOString().slice(0, 19);
        return format === 'yyyy-MM-01T00:00:00' ? `${date.slice(0, 7)}-01T00:00:00` : date;
      },
      convertTimeZone: (value, from, to) => {
        assert(['UTC', 'Tokyo Standard Time'].includes(from));
        assert(['UTC', 'Tokyo Standard Time'].includes(to));
        const time = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
        const offset = (from === 'UTC' ? 0 : -9) + (to === 'UTC' ? 0 : 9);
        return new Date(time + offset * 3600000).toISOString().slice(0, 19);
      },
      addToTime: (value, count, unit) => {
        assert.equal(unit, 'Month');
        const time = new Date(`${value}Z`);
        time.setUTCMonth(time.getUTCMonth() + count);
        return time.toISOString().slice(0, 19);
      },
    },
  };
  function evaluate(value) {
    if (Array.isArray(value)) return value.map(evaluate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, evaluate(child)]));
    if (typeof value !== 'string') return value;
    if (value.startsWith('@') && !value.startsWith('@{')) return expression(value.slice(1), context);
    return value.replace(/@\{([^}]+)\}/g, (_, code) => String(expression(code, context)));
  }
  function condition(value) {
    const [operator, args] = Object.entries(value)[0];
    if (operator === 'and') return args.every(condition);
    if (operator === 'or') return args.some(condition);
    if (operator === 'not') return !condition(args);
    const [a, b] = evaluate(args);
    if (operator === 'equals') return context.functions.equals(a, b);
    if (operator === 'greaterOrEquals') return a >= b;
    throw new Error(`Unsupported condition ${operator}`);
  }
  function execute(actions) {
    for (const [name, action] of Object.entries(actions)) {
      trace.push(name);
      if (options.failAction === name) throw new Error(`Injected failure ${name}`);
      if (action.type === 'If') {
        execute(condition(action.expression) ? action.actions : action.else.actions);
        continue;
      }
      const inputs = action.type === 'Select' ? { from: evaluate(action.inputs.from) } : evaluate(action.inputs);
      switch (action.type) {
        case 'Compose': outputs[name] = inputs; break;
        case 'Terminate': throw new Error(inputs.runError.code);
        case 'ParseJson':
          validateSchema(inputs.content, inputs.schema);
          bodies[name] = inputs.content;
          break;
        case 'Select':
          bodies[name] = inputs.from.map(record => {
            item = record;
            return evaluate(action.inputs.select);
          });
          break;
        case 'Table': {
          assert.equal(inputs.format, 'CSV');
          const columns = Object.keys(inputs.from[0] ?? {});
          const field = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value ?? '');
          bodies[name] = inputs.from.length
            ? [columns, ...inputs.from.map(record => columns.map(column => record[column]))].map(row => row.map(field).join(',')).join('\r\n') + '\r\n'
            : '';
          break;
        }
        case 'ApiConnection':
          if (inputs.host.connection.name === 'mock-logs') {
            const records = sampleRecords(params.KQL_BODY).filter(record =>
              Date.parse(record.TimeGenerated) >= Date.parse(`${outputs.StartUtc}Z`) &&
              Date.parse(record.TimeGenerated) < Date.parse(`${outputs.EndUtc}Z`));
            bodies[name] = options.queryResponse ?? { value: records.map(bag => ({ bag })) };
          } else {
            assert.equal(inputs.host.connection.name, 'mock-blob');
            if (inputs.method === 'post') {
              const path = `${inputs.queries.folderPath}/${inputs.queries.name}`;
              blobs.set(path, Buffer.from(inputs.body, 'utf8'));
              bodies[name] = { Id: path };
            } else {
              assert.equal(inputs.method, 'get');
              const id = decodeURIComponent(decodeURIComponent(inputs.path.match(/\/files\/(.+)\/content$/)[1]));
              assert(blobs.has(id), 'Missing saved CSV');
              bodies[name] = options.readBack ?? { $content: blobs.get(id).toString('base64'), '$content-type': 'application/octet-stream' };
            }
          }
          break;
        default: throw new Error(`Unsupported action ${action.type}`);
      }
    }
  }
  try {
    execute(definition.actions.Export.actions);
    return { status: 'Succeeded', blobs, outputs, bodies, trace };
  } catch (error) {
    return { status: 'Failed', error, blobs, outputs, bodies, trace };
  }
}
