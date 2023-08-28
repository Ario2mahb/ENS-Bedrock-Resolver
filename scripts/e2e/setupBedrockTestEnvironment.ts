import {
    BedrockProofVerifier,
    BedrockProofVerifier__factory,
    CcipResolver,
    ERC3668Resolver__factory,
    ENSRegistry__factory,
} from "ccip-resolver/dist/typechain/";
import { dnsEncode, keccak256, toUtf8Bytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import {
    ENS,
    L2PublicResolver,
    L2PublicResolverVerifier,
    L2PublicResolverVerifier__factory,
    L2PublicResolver__factory,
} from "../../typechain";
import { dnsWireFormat } from "../helper/encodednsWireFormat";
import { formatsByCoinType } from "@ensdomains/address-encoder";

/**
 * This script is used to setup the environment for the e2e tests.
 * It asumes that you've set up the local development environment for OP bedrock
 * https://community.optimism.io/docs/developers/build/dev-node/
 * */

//0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
const whale = new ethers.Wallet("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

//0x8111DfD23B99233a7ae871b7c09cCF0722847d89
const alice = new ethers.Wallet("0xfd9f3842a10eb01ccf3109d4bd1c4b165721bf8c26db5db7570c146f9fad6014");
//0x504846E80A4eE8C6Eb46ec4AD64150d3f554F6b8
const bob = new ethers.Wallet("0xb03367a9007c929dfdb33237ed31e27a3d1e62f5a69ca00bb90001d6063dda4e");

const l1Provider = new ethers.providers.StaticJsonRpcProvider("http://localhost:8545");
const l2Provider = new ethers.providers.StaticJsonRpcProvider("http://localhost:9545");

const setupBedrockTestEnvironment = async () => {
    //Verifiy that the local development environment is set up correctly
    if ((await l1Provider.getNetwork()).chainId !== 900 || (await l2Provider.getNetwork()).chainId !== 901) {
        console.error("Please ensure that you're running the local development environment for OP bedrock");
        return;
    }
    console.log("Start setting up environment for bedrock e2e tests");
    //Ens registry
    let ensRegistry: ENS;

    //CcipResolver
    let ccipResolver: CcipResolver;
    //BedrockProofVerifier
    let bedrockProofVerifier: BedrockProofVerifier;
    //BedrockCcipVerifier
    let l2PublicResolverVerifier: L2PublicResolverVerifier;

    //The resolver that is linked in the OptimismResolver contract
    let l2PublicResolver: L2PublicResolver;
    //Another resolver contract not related to the OptimismResolver contract
    let foreignResolver: L2PublicResolver;

    const l1Whale = whale.connect(l1Provider);
    const l2Whale = whale.connect(l2Provider);
    /**
     * ///////////////////////////////////////////////////////////////
     * Fund accounts
     * ///////////////////////////////////////////////////////////////
     * */

    //Fund alice account
    const fundAliceL1Tx = await l1Whale.sendTransaction({
        to: alice.address,
        value: ethers.utils.parseEther("100"),
    });
    const fundAlicel2Tx = await l2Whale.sendTransaction({
        to: alice.address,
        value: ethers.utils.parseEther("100"),
    });

    //Fund bob account
    const fundTxbob = await l2Whale.sendTransaction({
        to: bob.address,
        value: ethers.utils.parseEther("100"),
    });

    await Promise.all([fundAliceL1Tx.wait(), fundAlicel2Tx.wait(), fundTxbob.wait()]);

    console.log("Funded accounts");
    console.log("Alice L1 balance", ethers.utils.formatEther(await l1Provider.getBalance(alice.address)));
    console.log("Alice L2 balance", ethers.utils.formatEther(await l2Provider.getBalance(alice.address)));
    console.log("Bob L2 balance", ethers.utils.formatEther(await l2Provider.getBalance(bob.address)));

    const l1Alice = alice.connect(l1Provider);
    /**
     * ///////////////////////////////////////////////////////////////
     * MOCK ENS REGISTRY
     * ///////////////////////////////////////////////////////////////
     * */
    ensRegistry = await new ENSRegistry__factory().connect(l1Alice).deploy();

    await ensRegistry.connect(l1Alice).setOwner(ethers.constants.HashZero, l1Alice.address);

    await ensRegistry
        .connect(l1Alice)
        .setSubnodeOwner(ethers.constants.HashZero, ethers.utils.keccak256(ethers.utils.toUtf8Bytes("eth")), l1Alice.address, {
            gasLimit: 500000,
        });

    await ensRegistry
        .connect(l1Alice)
        .setSubnodeOwner(ethers.utils.namehash("eth"), ethers.utils.keccak256(ethers.utils.toUtf8Bytes("alice")), l1Alice.address, {
            gasLimit: 500000,
        });
    await ensRegistry
        .connect(l1Alice)
        .setSubnodeOwner(ethers.utils.namehash("alice.eth"), ethers.utils.keccak256(ethers.utils.toUtf8Bytes("a")), l1Alice.address, {
            gasLimit: 500000,
        });

    /**
     * ///////////////////////////////////////////////////////////////
     * DEPLOY L2 RESOLVER
     */

    l2PublicResolver = await new L2PublicResolver__factory().connect(l2Whale).deploy();
    console.log(`L2 Resolver deployed at ${l2PublicResolver.address}`);

    foreignResolver = await new L2PublicResolver__factory().connect(l2Whale).deploy();
    console.log(`L2 Foreign resolver deployed at ${foreignResolver.address}`);

    bedrockProofVerifier = await new BedrockProofVerifier__factory().connect(l1Whale).deploy("0x6900000000000000000000000000000000000000");
    console.log(`BedrockProofVerifier deployed at ${bedrockProofVerifier.address}`);

    l2PublicResolverVerifier = await new L2PublicResolverVerifier__factory()
        .connect(l1Whale)
        .deploy(whale.address, "localhost:8000/graphql", "", 420, bedrockProofVerifier.address, l2PublicResolver.address);

    console.log(`BedrockCcipVerifier deployed at ${l2PublicResolverVerifier.address}`);

    ccipResolver = await new ERC3668Resolver__factory()
        .connect(l1Whale)
        .deploy(
            ensRegistry.address,
            ethers.Wallet.createRandom().address,
            l2PublicResolverVerifier.address,
            ["http://localhost:8081/{sender}/{data}"],
            {
                gasLimit: 10000000,
            }
        );

    console.log(`CcipResolver deployed at ${ccipResolver.address}`);

    //Setup resolver for alice.eth
    const ccipResolverTx = await ccipResolver
        .connect(l1Alice)
        .setVerifierForDomain(
            ethers.utils.namehash("alice.eth"),
            l2PublicResolverVerifier.address,
            ["http://localhost:8081/{sender}/{data}"],
            {
                gasLimit: 1000000,
            }
        );

    await ccipResolverTx.wait();

    console.log(`${alice.address} funded with ${await l2Provider.getBalance(alice.address)}`);
    console.log(`${bob.address} funded with ${await l2Provider.getBalance(bob.address)}`);

    //Create data on L2 that later be used for the tests
    const prepareTestSingleSlot = async () => {
        //Prepare test single slot
        const name = dnsEncode("alice.eth");

        const recordName = "foo";
        const value = "bar";
        await l2PublicResolver.connect(alice.connect(l2Provider)).setText(name, recordName, value),
            {
                gasLimit: 1000000,
            };
    };

    //Prepare test 31 byte
    const prepareTest31yte = async () => {
        const name = dnsEncode("alice.eth");
        const recordName = "my-slot";
        const value = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        await l2PublicResolver.connect(alice.connect(l2Provider)).setText(name, recordName, value, {
            gasLimit: 1000000,
        });
    };

    //Prepare test multiple slots
    const prepeTestMultipleSlots = async () => {
        const name = dnsEncode("alice.eth");
        const recordName = "network.dm3.eth";

        const profile = {
            publicSigningKey: "0ekgI3CBw2iXNXudRdBQHiOaMpG9bvq9Jse26dButug=",
            publicEncryptionKey: "Vrd/eTAk/jZb/w5L408yDjOO5upNFDGdt0lyWRjfBEk=",
            deliveryServices: ["foo.dm3"],
        };

        const x = await l2PublicResolver.connect(alice.connect(l2Provider)).setText(name, recordName, JSON.stringify(profile), {
            gasLimit: 1000000,
        });

        await x.wait();
        console.log("Multislot set");
    };

    //Prepare setAddr
    const prepareSetAddr = async () => {
        const name = dnsEncode("alice.eth");
        await l2PublicResolver.connect(alice.connect(l2Provider))["setAddr(bytes,address)"](name, alice.address, {
            gasLimit: 1000000,
        });
    };
    const prepareSetblockchainAddr = async () => {
        const name = dnsEncode("alice.eth");

        const btcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
        const btcCoinType = 0;
        //See https://github.com/ensdomains/ensjs-v3/blob/c93759f1197e63ca98006f6ef8edada5c4a332f7/packages/ensjs/src/utils/recordHelpers.ts#L43
        const cointypeInstance = formatsByCoinType[btcCoinType];
        const decodedBtcAddress = cointypeInstance.decoder(btcAddress);
        const tx = await l2PublicResolver
            .connect(alice.connect(l2Provider))
            ["setAddr(bytes,uint256,bytes)"](name, btcCoinType, decodedBtcAddress, {
                gasLimit: 1000000,
            });
        await tx.wait();
    };
    const prepareSetAbi = async () => {
        const name = dnsEncode("alice.eth");
        const abi = bedrockProofVerifier.interface.format(ethers.utils.FormatTypes.json);

        const tx = await l2PublicResolver.connect(alice.connect(l2Provider)).setABI(name, 1, ethers.utils.toUtf8Bytes(abi.toString()), {
            gasLimit: 10000000,
        });

        await tx.wait();
    };
    const prepareSetContentHash = async () => {
        const name = dnsEncode("alice.eth");

        await l2PublicResolver
            .connect(alice.connect(l2Provider))
            .setContenthash(name, "0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f", {
                gasLimit: 1000000,
            });
    };
    const prepareSetName = async () => {
        const nodeName = dnsEncode("alice.eth");
        const name = "alice";

        const tx = await l2PublicResolver.connect(alice.connect(l2Provider)).setName(nodeName, name, {
            gasLimit: 1000000,
        });
        await tx.wait();
    };

    const prepareSetDNS = async () => {
        const nodeName = dnsEncode("alice.eth");

        const record = dnsWireFormat("a.example.com", 3600, 1, 1, "1.2.3.4");

        const tx = await l2PublicResolver.connect(alice.connect(l2Provider)).setDNSRecords(nodeName, "0x" + record, {
            gasLimit: 1000000,
        });

        await tx.wait();
    };
    const prepareSetZonehash = async () => {
        const nodeName = dnsEncode("alice.eth");
        const tx = await l2PublicResolver.connect(alice.connect(l2Provider)).setZonehash(nodeName, keccak256(toUtf8Bytes("foo")), {
            gasLimit: 1000000,
        });

        await tx.wait();
    };

    const prepareTestSubdomain = async () => {
        const name = dnsEncode("a.alice.eth");
        const recordName = "my-slot";
        const value = "my-subdomain-record";

        const tx = await l2PublicResolver.connect(alice.connect(l2Provider)).setText(name, recordName, value, {
            gasLimit: 1000000,
        });
        await tx.wait();
    };
    const prepareTestSubdomain2 = async () => {
        const name = dnsEncode("alice.eth");

        const recordName = "bobs-slot";
        const value = "bobs-subdomain-record";

        const tx = await l2PublicResolver.connect(bob.connect(l2Provider)).setText(name, recordName, value, {
            gasLimit: 1000000,
        });
        await tx.wait();
    };
    const nameWrapperProfile = async () => {
        const name = dnsEncode("namewrapper.alice.eth");
        const recordName = "namewrapper-slot";
        const value = "namewrapper-subdomain-record";

        const tx = await l2PublicResolver.connect(alice.connect(l2Provider)).setText(name, recordName, value, {
            gasLimit: 1000000,
        });
        await tx.wait();
    };
    //Prepare foreign resolver
    const prepareForeign = async () => {
        const name = dnsEncode("alice.eth");
        await foreignResolver.connect(alice.connect(l2Provider))["setAddr(bytes,address)"](name, alice.address, {
            gasLimit: 1000000,
        });
    };
    await prepareTestSingleSlot();
    await prepareTest31yte();
    await prepeTestMultipleSlots();
    await prepareSetAddr();
    await prepareSetblockchainAddr();
    await prepareSetAbi();
    await prepareSetContentHash();
    await prepareSetName();
    await prepareSetDNS();
    await prepareSetZonehash();
    await prepareTestSubdomain();
    await prepareTestSubdomain2();
    await nameWrapperProfile();
    await prepareForeign();
    console.log("Environment setup complete wait a few minutes until everything is set");
};
setupBedrockTestEnvironment();
