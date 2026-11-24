// Baseline comparison: includes differences in authorization, so do not attribute all delta to packing.
const hre = require('hardhat');
const {ethers}=hre;
async function main(){
 const [admin,verifier,borrower]=await ethers.getSigners();
 const registry=await ethers.deployContract('Registry',[admin.address]); await registry.waitForDeployment();
 await registry.assignRole(verifier.address,4);
 const kyc=ethers.keccak256(ethers.toUtf8Bytes('gas-workflow'));
 await registry.connect(borrower).register(16,kyc);
 await registry.connect(verifier).verifyUser(borrower.address);
 const opt=await ethers.deployContract('CoreWorkflow',[await registry.getAddress()]); await opt.waitForDeployment();
 const base=await ethers.deployContract('WorkflowBaseline'); await base.waitForDeployment();
 await (await opt.connect(borrower).requestLoan(1000)).wait();
 await (await base.connect(borrower).requestLoan(1000)).wait();
 const a=await (await base.connect(verifier).approveLoan(1)).wait();
 const b=await (await opt.connect(verifier).approveLoan(1)).wait();
 const baseline=Number(a.gasUsed), optimized=Number(b.gasUsed);
 console.log(JSON.stringify({operation:'approveLoan',baselineGas:baseline,optimizedGas:optimized,changePercent:+((optimized-baseline)/baseline*100).toFixed(2),note:'NOT equivalent authorization: baseline omits Registry checks. Use as illustrative measurement only; not a defensible isolated optimization claim.'},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
