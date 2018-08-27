// Convert raw data into index ready data
const assert = require("assert");

const remapRec = (specs, input) => {
  const result = [];
  assert(specs.sources === undefined || (Array.isArray(specs.sources) && specs.sources.length !== 0));
  (specs.sources || [""])
    // resolve to all objects for path
    .map(sourcePath => (sourcePath === "" ? input : sourcePath.split(".").reduce(
      (origins, segment) => origins
        .map(origin => origin[segment])
        .filter(origin => !!origin)
        .reduce((prev, next) => prev.concat(Array.isArray(next) ? next : [next]), []),
      [input]
    )))
    // filter invalid origins
    .filter(origins => !!origins)
    // ensure origins are array
    .map(origins => (Array.isArray(origins) ? origins : [origins]))
    // extract recursively
    .forEach(origins => origins.forEach((origin) => {
      const entry = {};
      specs.fields // handle top level
        .map(field => [field, origin[field]])
        .filter(kv => kv[1] !== undefined)
        .reduce((prev, [key, value]) => Object.assign(prev, { [key]: value }), entry);
      Object.entries(specs.nested || {}) // handle nested
        .map(([key, value]) => [key, remapRec(value, origin)])
        .filter(kv => kv[1] !== undefined)
        .reduce((prev, [key, value]) => Object.assign(prev, { [key]: value }), entry);
      result.push(entry);
    }));
  assert(specs.model.endsWith("[]") || result.length <= 1);
  return specs.model.endsWith("[]") ? result : result[0];
};

module.exports.remap = (specs, input) => remapRec(specs, input);