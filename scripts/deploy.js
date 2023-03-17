// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.


/*
{
  "owner":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "tokenId":99999999,
  "name":"",
  "externalUrl":"",
  "metadata":"",
  "unlockTime":0,
  "targetBalance":0,
  "piggyBank":"0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
}

["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",99999999,"","","",0,0,"0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"]
*/

// factory constructor params:
// "RemixTest","CTR","0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 400,"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"

const hre = require("hardhat");

function callback(x) {
  console.log(x)
}

async function main() {

  const _name = 'PiggiesTEST18'
  const _symbol = 'CPG'
  const _royaltyRecipient = '0x92abb8F1238a81E55C5310C6D1baf399Be1b483C'
  const _royaltyBps = '400'
  const _primarySaleRecipient = '0x92abb8F1238a81E55C5310C6D1baf399Be1b483C';

  const _libAddress = '0x4eEa97281346D80b5Ef66FC9c7E7d54Af8fC2738' // Goerli deployed via thirdweb
  const _implAddress = '0x0f8f457e28dEeF3480C9954D7E05a23094DF0DA0' // Goerli deployed PB implementation*/

  // get the library if it's already deployed
  const lib = await ethers.getContractAt("Utils", _libAddress );
  console.log('got library at ', lib.address);
  
  // Get contract that we want to deploy
  const PiggyFactory = await hre.ethers.getContractFactory("CryptoPiggies", {
    libraries: {
      Utils: lib.address,
    }}
  );

  // deploy
  const deployedFactory = await PiggyFactory.deploy(_name, _symbol, _royaltyRecipient, _royaltyBps, _primarySaleRecipient, _implAddress);

  // Wait for this transaction to be mined
  await deployedFactory.deployed();

  // Get contract address
  console.log("Owner is: ", await deployedFactory.owner())

  console.log('PiggyFactory address:', deployedFactory.address)

  /*// then deploy the implementation piggy bank that the factory can then clone:
  const Piggy = await hre.ethers.getContractFactory("PiggyBank");

  const deployedPiggy = await Piggy.deploy();

  await deployedPiggy.deployed();
  console.log(deployedPiggy);*/

  /*const data = {
    owner: owner,
    tokenId: 0,
    name: '',
    supply: 1,
    externalUrl: '',
    targetBalance: ethers.BigNumber.from(99),
    piggyBank: owner
  }*/


/*  // deploy piggybank implementation
  const PiggyBank = await ethers.getContractFactory("PiggyBank");
  const deployedPiggyBankImplementation = await PiggyBank.deploy();
  await deployedPiggyBankImplementation.deployed();

  //console.log('deployed PiggyBank:', deployedPiggyBankImplementation)

  //https://portal.thirdweb.com/typescript/sdk.erc1155signaturemintable

  // window in which the signature will remain valid
  const startTime = new Date();
  const endTime = new Date(Date.now() + 60 * 60 * 24 * 1000);

  const mintRequest = {
    quantity: ethers.BigNumber.from(12),
    validityStartTimestamp: startTime,
    validityEndTimestamp: endTime,
    name: "This is the implementation",
    externalUrl: '',
    unlockTime: 1675514261,
    targetBalance: ethers.BigNumber.from(99),
    tokenId: ethers.BigNumber.from(0)
  }

  // generate signature for mint request:
  const signedPayload = await deployedFactory.erc1155.signature.generate(payload);

  const tx = await deployedFactory.erc1155.signature.mint(signedPayload);

  console.log(x)*/

  //initialise

  /*
  struct MintRequest {
    uint256 quantity;
    uint128 validityStartTimestamp;
    uint128 validityEndTimestamp;
    string name;
    string externalUrl;
    uint256 unlockTime;
    uint256 targetBalance;
    uint256 tokenId;
}



*/


}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
