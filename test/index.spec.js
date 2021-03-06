const path = require("path");
const uuidv4 = require('uuid/v4');
const expect = require("chai").expect;
const chai = require("chai");
const deepEqualInAnyOrder = require('deep-equal-in-any-order');
const Index = require('../src/index');

chai.use(deepEqualInAnyOrder);

const models = Index.loadJsonInDir(path.join(__dirname, "models"));
const indices = Index.loadJsonInDir(path.join(__dirname, "indices"));
const mappings = Index.loadJsonInDir(path.join(__dirname, "mappings"));
const fields = Index.loadJsonInDir(path.join(__dirname, "fields"));
const rels = Index.loadJsonInDir(path.join(__dirname, "rels"));
const remaps = Index.loadJsonInDir(path.join(__dirname, "remaps"));
const query = Index.loadJsonInDir(path.join(__dirname, "query"));
const queryMappings = Index.loadJsonInDir(path.join(__dirname, "query", "mappings"));

describe('Testing index', () => {
  let index;
  beforeEach(() => {
    index = Index({ endpoint: process.env.elasticsearchEndpoint });
    Object.entries(models).forEach(([name, specs]) => {
      index.model.register(name, specs);
    });
    Object.entries(indices).forEach(([name, specs]) => {
      index.index.register(name, specs);
    });
  });

  it('Testing models', () => {
    Object.entries(indices).forEach(([k, v]) => {
      expect(index.index.getModel(k)).to.equal(v.model);
    });
  });

  it('Testing specs', () => {
    Object.entries(indices).forEach(([k, v]) => {
      expect(index.index.getSpecs(k)).to.deep.equal(Object.assign({ name: k }, v));
    });
  });

  it('Testing mappings', () => {
    expect(index.index.list()).to.deep.equal(Object.keys(mappings).sort());
    Object.entries(mappings).forEach(([k, v]) => {
      expect(index.index.getMapping(k)).to.deep.equal(v);
    });
  });

  it('Testing fields', () => {
    expect(index.index.list()).to.deep.equal(Object.keys(fields).sort());
    Object.entries(fields).forEach(([k, v]) => {
      expect(index.index.getFields(k)).to.deep.equal(v);
    });
  });

  it('Testing rels', () => {
    expect(index.index.list()).to.deep.equal(Object.keys(rels).sort());
    Object.entries(rels).forEach(([k, v]) => {
      expect(index.index.getRels(k)).to.deep.equal(v);
    });
  });

  it('Testing remap', () => {
    Object.entries(remaps).forEach(([k, v]) => {
      const remapped = index.data.remap(v.index, v.input);
      expect(remapped, `Debug: ${JSON.stringify(remapped)}`).to.deep.equal(v.result);
    });
  });

  describe('Testing Query Creation', () => {
    it('Testing query.build', () => {
      Object.entries(query).forEach(([k, v]) => {
        const result = index.query.build(null, {
          toReturn: v.toReturn || [""],
          filterBy: v.filterBy || [],
          orderBy: v.orderBy || [],
          scoreBy: v.scoreBy || [],
          limit: v.limit,
          offset: v.offset
        });
        expect(result, `Debug: ${JSON.stringify(result)}`).to.deep.equalInAnyOrder(v.result);
      });
    });

    it('Testing query.build with defaults', () => {
      expect(index.query.build()).to.deep.equal({
        _source: [""],
        size: 20,
        from: 0,
        sort: [{ id: { mode: "max", order: "asc" } }]
      });
    });
  });

  describe('Testing nested filtering', () => {
    it('Testing allow separate relationships', async () => {
      const offerId = uuidv4();
      expect(await index.rest.mapping.recreate("offer")).to.equal(true);
      expect(await index.rest.data.update("offer", {
        upsert: [{
          id: offerId,
          locations: [{
            id: uuidv4(),
            address: { id: uuidv4(), street: "value1", city: "value1" }
          }, {
            id: uuidv4(),
            address: { id: uuidv4(), street: "value2", city: "value2" }
          }]
        }]
      })).to.equal(true);
      expect(await index.rest.data.refresh("offer")).to.equal(true);
      expect((await index.rest.data.query("offer", index.query.build("offer", {
        filterBy: {
          target: "union",
          and: ["locations.address.street == value1", "locations.address.city == value2"]
        }
      }))).payload.length).to.equal(1);
      expect((await index.rest.data.query("offer", index.query.build("offer", {
        filterBy: {
          target: "separate",
          and: ["locations.address.street == value1", "locations.address.city == value2"]
        }
      }))).payload.length).to.equal(0);
    }).timeout(10000);
  });

  describe('Testing REST interaction', () => {
    it('Testing lifecycle', async () => {
      const uuids = [uuidv4(), uuidv4(), uuidv4()].sort();
      await index.rest.mapping.delete("offer");
      expect(await index.rest.mapping.list()).to.deep.equal([]);
      expect(await index.rest.mapping.create("offer")).to.equal(true);
      expect(await index.rest.mapping.create("offer")).to.equal(false);
      expect(await index.rest.mapping.recreate("offer")).to.equal(true);
      expect(await index.rest.mapping.list()).to.deep.equal(["offer"]);
      expect((await index.rest.mapping.get("offer")).body.offer).to.deep.equal(index.index.getMapping("offer"));
      expect(await index.rest.data.query("offer", index.query.build())).to.deep.equal({
        payload: [],
        page: {
          next: null,
          prev: null,
          cur: 1,
          max: 1,
          size: 20
        }
      });
      expect(await index.rest.data.update("offer", { upsert: uuids.map(id => ({ id })) })).to.equal(true);
      expect(await index.rest.data.refresh("offer")).to.equal(true);
      expect(await index.rest.data.count("offer")).to.equal(3);
      expect(await index.rest.data.query("offer", index.query.build("offer", {
        toReturn: ["id"],
        filterBy: { and: [["id", "in", uuids]] },
        limit: 1,
        offset: 1
      }))).to.deep.equal({
        payload: [{ id: uuids[1] }],
        page: {
          next: { limit: 1, offset: 2 },
          prev: { limit: 1, offset: 0 },
          max: 3,
          cur: 2,
          size: 1
        }
      });
      expect(await index.rest.data.update("offer", { remove: uuids })).to.equal(true);
      expect(await index.rest.data.refresh("offer")).to.equal(true);
      expect(await index.rest.data.count("offer")).to.equal(0);
      expect(await index.rest.mapping.delete("offer")).to.equal(true);
    }).timeout(10000);

    it('Testing delete not found', async () => {
      expect(await index.rest.mapping.delete("offer")).to.equal(true);
    });

    it('Testing count not found', async () => {
      expect(await index.rest.data.count("offer")).to.equal(false);
    });

    it('Testing create no action', async () => {
      expect(await index.rest.data.update("offer", {})).to.equal(true);
    });

    it('Testing call without options', async () => {
      expect((await index.rest.call("GET", uuidv4())).statusCode).to.equal(404);
    });

    it('Query with Batch Examples', async () => {
      // setup mappings
      await Promise.all(Object.entries(queryMappings).map(([idx, meta]) => index.rest
        .call("DELETE", idx).then(() => index.rest.call('PUT', idx, { body: meta }))));
      expect((await index.rest.mapping.list()).sort())
        .to.deep.equal(['offer', 'region', 'venue'].sort());
      // run tests
      await Object.entries(queryMappings)
        .map(([idx, v]) => index.rest.data.query(
          idx,
          index.query.build(null, {
            toReturn: v.toReturn,
            filterBy: v.filterBy || [],
            orderBy: v.orderBy || [],
            scoreBy: v.scoreBy || [],
            limit: v.limit,
            offset: v.offset
          }),
          { raw: true }
        ).then((r) => {
          expect(r).to.deep.contain({
            _shards: {
              failed: 0,
              skipped: 0,
              successful: 5,
              total: 5
            },
            timed_out: false
          });
        }))
        .reduce((p, c) => p.then(() => c), Promise.resolve());
      // cleanup mappings
      await Promise.all(Object.keys(queryMappings).map(idx => index.rest.mapping.delete(idx)));
    }).timeout(10000);
  });
});
