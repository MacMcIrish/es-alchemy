[![Build Status](https://circleci.com/gh/loopmediagroup/es-alchemy.png?style=shield)](https://circleci.com/gh/loopmediagroup/es-alchemy)
[![Test Coverage](https://img.shields.io/coveralls/loopmediagroup/es-alchemy/master.svg)](https://coveralls.io/github/loopmediagroup/es-alchemy?branch=master)
[![Dependabot Status](https://api.dependabot.com/badges/status?host=github&repo=loopmediagroup/es-alchemy)](https://dependabot.com)
[![Dependencies](https://david-dm.org/loopmediagroup/es-alchemy/status.svg)](https://david-dm.org/loopmediagroup/es-alchemy)
[![NPM](https://img.shields.io/npm/v/es-alchemy.svg)](https://www.npmjs.com/package/es-alchemy)
[![Downloads](https://img.shields.io/npm/dt/es-alchemy.svg)](https://www.npmjs.com/package/es-alchemy)
[![Semantic-Release](https://github.com/simlu/js-gardener/blob/master/assets/icons/semver.svg)](https://github.com/semantic-release/semantic-release)
[![Gardener](https://github.com/simlu/js-gardener/blob/master/assets/badge.svg)](https://github.com/simlu/js-gardener)

# ESAlchemy

Simplification of Elasticsearch interactions

## Install

```bash
npm i --save es-alchemy
```

## Setup

Outline of how [ESAlchemy](https://github.com/loopmediagroup/es-alchemy) can be used, step by step:

- Define data models
- Define indices based on the data models
- Generate mappings from indices and then create them in Elasticsearch
- Obtain input data as defined in the source mappings of index and remap it
- Insert remapped data into Elasticsearch
- Build a query using the ES-Alchemy query syntax
- Run query against Elasticsearch

### Model and Index Definitions

#### Models

Models definitions contain the fields of a model and their types. They restrict how an index can be put together.

Example: **address.json**
```json
{
  "fields": {
    "id": "uuid",
    "street": "string",
    "city": "string",
    "country": "string",
    "centre": "point",
    "area": "shape",
    "timezone": "string"
  }
}
```

Preferably a folder `models` contains a json file for each model. An example can be
found in the [test folder](test/models).

Fields that can be used and how they get mapped in Elasticsearch can 
be found [here](src/resources/field-definitions.json).

#### Indices

Indices define how data, models and  mappings all tie together.

Example: **location.json**
```json
{
  "model": "location",
  "fields": [
    "id",
    "name"
  ],
  "nested": {
    "address": {
      "model": "address",
      "fields": [
        "id",
        "street",
        "city",
        "country",
        "centre",
        "area",
        "timezone"
      ],
      "sources": [
        "address"
      ]
    }
  }
}

```

Preferably a folder `indices` contains a json file for each index. An example can be
found in the [test folder](test/indices).

Each index is defined as a nested structure of nodes. 
Nodes are defined recursively and each node has the following fields:

##### version

Type: `string`<br>
Default: `null`

Defines the version of this index. Should only be defined on root node.

##### model

Type: `string`<br>
Required.

Model that is used for the node.

Can append `[]` for non-root nodes to indicate `to-many` relationship.

##### fields

Type: `Array`<br>
Required.

Fields of the node model that are included in this index. 
Needs to be a subset of the fields defined on the model.

##### sources

Type: `Array`<br>
Default: `[""]`

Defines the relative sources for data ingestion. 
How this works is explained under data ingestion and remapping.

##### nested

Type: `Object`<br>
Default: `{}`

Defines all children of the node. Keys indicate the 
relationship names and the values define the nodes.

To indicate that a `to-many` relationship is defined, append `[]` to the model name in the node.

##### flat

Type: `boolean`<br>
Default: `false`

This flag sets `include_in_root` to true on the generated Elasticsearch mapping.
Internally in Elasticsearch this means all fields get flattened into the root document of the mapping.

This is useful to reduce storage size by de-duplicating and to enforce 
`union` target style queries (see corresponding section for more on this).

### Loading Models and Indices

Loading models and indices into ES-Alchemy can be done as following.
Note that an index can only be registered once all models used in the index have been registered. 

<!-- eslint-disable import/no-unresolved -->
```js
const ESA = require("es-alchemy");

const esa = ESA({ endpoint: "localhost:9200" });

Object.entries(ESA.loadJsonInDir("path/to/models"))
  .forEach(([name, specs]) => esa.model.register(name, specs));
Object.entries(ESA.loadJsonInDir("path/to/indices"))
  .forEach(([name, specs]) => esa.index.register(name, specs));
```

### Generating Mappings

Mappings can be obtained from indices by calling:

`esa.index.getMapping("indexName");`

To (re)create a mapping in Elasticsearch run:

<!-- eslint-disable no-undef -->
```js
Promise.all(esa.index.list().map(idx => esa.rest.mapping.recreate(idx)))
  .then(() => {
    // ...
  });
```

### Remapping and Ingesting Data

To insert data into Elasticsearch we need a *source object*. Data is then extracted from this source object
and remapped into a *target object* that can be ingested into Elasticsearch.

To define how the source object gets remapped, the `sources` fields in the nodes of the index are used.

Multiple sources for a node can be defined. This is really convenient when mappings e.g. keywords from multiple
entities in the *source object* to a single keywords relationship on the index.

When an index relationship maps to a single model (`to-one`), it is expected that no more than one model is retrieved.

Models and their fields are picked up from all paths defined in the `sources` Array. An empty string indicates root level.
If a field is missing from a source, it is skipped. Unexpected fields are skipped.

Sources are defined relative to their parent sources.

*Known limitations:*
  - Fields can not be renamed when remapping

To remap and ingest data run

<!-- eslint-disable no-undef -->
```js
sourceObject = {/* ... */};
esa.rest.data
  .update("indexName", { upsert: [esa.data.remap("indexName", sourceObject)] });
```  

`// todo: this needs an example`

### Building Queries

To query data in Elasticsearch we first need to build a query. This is done using the ESAlchemy query syntax.

List of all available commands for `filterBy`, `orderBy` and `scoreBy` can be found [here](src/resources/action-map.js).

When building a query the following options are available.

#### toReturn

Type: `Array`<br>
Default: `[""]`

Indicates which fields should be returned in the result. Nested fields can be accessed using dot notation.

#### filterBy

Type: `Array|Object`<br>
Default: `[]`

Allow restriction of results.

Pass in object containing an `or` or `and` key, mapping to a list of filter options.

A filter option is either a similarly structured object, a filter array or a string (shorthand notation).

When `and` is used, a `target` key can also be present with the values `separate` or `union`. This option only takes 
effect when multiple clauses search the same relationship. When `separate` is used, all conditions need to be 
met on the same object. When union is used, they can be met on different objects in the relationship.

`// todo: this section needs improvement`

#### orderBy

Type: `Array`<br>
Default: `[]`

Allow ordering of results. Takes precedence over scoring.

#### scoreBy

Type: `Array`<br>
Default: `[]`

Allow scoring of results. Ordering takes precedence over scoring.

#### limit

Type: `Integer`<br>
Default: `20`

Maximum amount of results returned.

#### offset

Type: `Integer`<br>
Default: `0`

Results to skip at the beginning of the results.

## Constructor

#### protocol

Type: `string`<br>
Default: `http`

The protocol for connecting to Elasticsearch. Can be `http` or `https`.

#### endpoint

Type: `string`<br>
Default: `elasticsearch:9200`

The endpoint for connecting to Elasticsearch. Common values include `localhost:9200`.

#### aws

Type: `object`<br>
Default: `{}`

Allow connection to AWS Elasticsearch instance by passing 
in object containing `accessKeyId` and `secretAccessKey`.

## Api

Available commands

#### model

- `register(name: String, definition: Object)` - register a model with ES-Alchemy

#### index

- `register(name: String, definitions: Object)` - register an index with ES-Alchemy
- `list()` - list all indices registered with ES-Alchemy
- `getMapping(name: String)` - get the mapping for Elasticsearch for this index
- `getFields(name: String)` - get all fields (including nested) for this index
- `getRels(name: String)` - get all rels for this index (returned as object mapping to node type)
- `getModel(name: String)` - get top level model of this index

#### data

- `remap(name: String, source: Object)` - remap source object to ingestible object, see details in corresponding section

#### query

- `build(name: String?, options: Object)` - build a query, index is optional and can be passed as null, see details in corresponding section

#### rest

Interacting with the rest api of Elasticsearch

- `call(method: String, name: String, options: Object)` - make direct API call to Elasticsearch
- `mapping.create(name: String)` - create mapping on Elasticsearch
- `mapping.delete(name: String)` - delete mapping from Elasticsearch
- `mapping.get(name: String)` - get mapping details from Elasticsearch
- `mapping.recreate(name: String)` - recreate mapping on Elasticsearch
- `data.count(name: String)` - get number of indexed elements from Elasticsearch
- `data.query(name: String, filter: Object, options: Object)` - query for data in Elasticsearch. Use raw flag to obtain raw result from Elasticsearch.
- `data.refresh(name: String)` - refresh Elasticsearch index, useful e.g. when testing
- `data.update(name: String, options: Object)` - insert, update or delete objects in Elasticsearch


## Tests

All tests need to be run in docker. Start with:

```bash
. manage.sh
```

To test Elasticsearch works correctly, run

```bash
curl http://elasticsearch:9200/_cluster/health
```

Run all tests with

```bash
npm t
```
