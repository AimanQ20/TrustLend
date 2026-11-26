// Fair baseline vs optimized comparison for the loan workflow.
// Both contracts use the same Registry authorization, modifiers, checks, events and errors.
// The only difference is the Loan struct layout (unpacked uint256 amount vs packed borrower + uint96 amount).
const hre = require('hardhat');
const {ethers}=hre;
const fs=require('fs');
async function main(){
 const [admin,verifier,borrower]=await ethers.getSigners();
 const registry=await ethers.deployContract('Registry',[admin.address]); await registry.waitForDeployment();
 await registry.assignRole(verifier.address,4);
 const kyc=ethers.keccak256(ethers.toUtf8Bytes('gas-workflow'));
 await registry.connect(borrower).register(16,kyc);
 await registry.connect(verifier).verifyUser(borrower.address);
 const ra=await registry.getAddress();
 const opt=await ethers.deployContract('CoreWorkflow',[ra]); await opt.waitForDeployment();
 const base=await ethers.deployContract('WorkflowBaseline',[ra]); await base.waitForDeployment();
 const gas=async(p)=>Number((await (await p).wait()).gasUsed);
 // warm-up request on both so nextLoanId is non-zero in storage (steady state), then measure loan id 2
 await gas(base.connect(borrower).requestLoan(1000)); await gas(opt.connect(borrower).requestLoan(1000));
 const out=[];
 const row=(operation,b,o)=>({operation,baselineGas:b,optimizedGas:o,saved:b-o,changePercent:+((o-b)/b*100).toFixed(2)});
 const bReq=await gas(base.connect(borrower).requestLoan(1000)), oReq=await gas(opt.connect(borrower).requestLoan(1000));
 out.push(row('requestLoan',bReq,oReq));
 const bApp=await gas(base.connect(verifier).approveLoan(2)), oApp=await gas(opt.connect(verifier).approveLoan(2));
 out.push(row('approveLoan',bApp,oApp));
 console.log(JSON.stringify(out,null,2));
 fs.writeFileSync('docs/gas-workflow.json',JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
