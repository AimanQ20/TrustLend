// Off-chain wallet/role lookup service, tested end to end against a live (in-process) chain.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { createService } = require("../offchain/role-service/service");
const { ROLE, kyc, deployWithUsersFixture } = require("./helpers");

describe("Role lookup service (off-chain component)", function () {
  this.timeout(30000);
  let svc, base, f;

  before(async () => {
    f = await deployWithUsersFixture();
    await f.registry.connect(f.outsider).register(ROLE.BORROWER, kyc("pending-1")); // stays Pending
    svc = createService({ provider: ethers.provider, registryAddress: await f.registry.getAddress(), rateLimitPerMinute: 1000 });
    base = `http://127.0.0.1:${await svc.listen(0)}`;
  });
  after(async () => svc.close());
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

  it("GET /health reports chain, registry and block", async () => {
    const { status, body } = await get("/health");
    expect(status).to.equal(200);
    expect(body.ok).to.equal(true);
    expect(body.registry).to.equal(await f.registry.getAddress());
  });
  it("GET /v1/users/:address returns the on-chain profile (Active lender)", async () => {
    const { status, body } = await get(`/v1/users/${f.lender.address}`);
    expect(status).to.equal(200);
    expect(body.status).to.equal("Active");
    expect(body.roles).to.deep.equal(["LENDER"]);
    expect(body.isActive).to.equal(true);
    expect(body.kycRef).to.equal(kyc("lender"));
    expect(body.source.blockNumber).to.be.a("number");
  });
  it("accepts lowercase addresses and normalises them", async () => {
    const { body } = await get(`/v1/users/${f.verifier.address.toLowerCase()}`);
    expect(body.address).to.equal(f.verifier.address);
    expect(body.roles).to.deep.equal(["VERIFIER"]);
  });
  it("unknown wallets are reported as None, not as an error", async () => {
    const { body } = await get(`/v1/users/${f.other.address}`);
    expect(body.status).to.equal("None");
    expect(body.roles).to.deep.equal([]);
  });
  it("lists role members rebuilt from events and re-verified on-chain", async () => {
    const { body } = await get("/v1/roles/verifier/members");
    expect(body.members.map((m) => m.address)).to.deep.equal([f.verifier.address]);
    const lenders = await get("/v1/roles/LENDER/members");
    expect(lenders.body.members.map((m) => m.address)).to.deep.equal([f.lender.address]);
  });
  it("a revoked role disappears from the list immediately (events are only candidates)", async () => {
    await f.registry.connect(f.admin).revokeRole(f.arbiter.address, ROLE.ARBITER);
    const { body } = await get("/v1/roles/ARBITER/members");
    expect(body.count).to.equal(0);
  });
  it("lists the Pending KYC queue and drops users once verified", async () => {
    let r = await get("/v1/users?status=Pending");
    expect(r.body.users.map((u) => u.address)).to.deep.equal([f.outsider.address]);
    await f.registry.connect(f.verifier).verifyUser(f.outsider.address);
    r = await get("/v1/users?status=Pending");
    expect(r.body.count).to.equal(0);
    r = await get("/v1/users?status=Active");
    expect(r.body.users.map((u) => u.address)).to.include(f.outsider.address);
  });
  it("rejects bad input and unknown routes with proper status codes", async () => {
    expect((await get("/v1/users/not-an-address")).status).to.equal(400);
    expect((await get("/v1/roles/KING/members")).status).to.equal(404);
    expect((await get("/v1/users?status=None")).status).to.equal(400);
    expect((await get("/nope")).status).to.equal(404);
    const post = await fetch(base + "/health", { method: "POST" });
    expect(post.status).to.equal(405);
  });
  it("returns 503 retryable when the blockchain node is unreachable", async () => {
    const dead = new ethers.JsonRpcProvider("http://127.0.0.1:1", undefined, { staticNetwork: true, batchMaxCount: 1 });
    const s2 = createService({ provider: dead, registryAddress: await f.registry.getAddress() });
    const url = `http://127.0.0.1:${await s2.listen(0)}`;
    const r = await fetch(`${url}/v1/users/${f.lender.address}`);
    const body = await r.json();
    expect(r.status).to.equal(503);
    expect(body.retryable).to.equal(true);
    await s2.close();
    dead.destroy();
  });
  it("rate-limits abusive clients", async () => {
    const s3 = createService({ provider: ethers.provider, registryAddress: await f.registry.getAddress(), rateLimitPerMinute: 3 });
    const url = `http://127.0.0.1:${await s3.listen(0)}`;
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${url}/v1/roles`)).status);
    expect(codes).to.deep.equal([200, 200, 200, 429, 429]);
    await s3.close();
  });
});
