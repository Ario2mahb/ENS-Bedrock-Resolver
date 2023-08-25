import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers.js";
import { ethers } from "hardhat";

import { L2PublicResolver } from "typechain";

import { expect } from "chai";
import { BigNumber } from "ethers";
import { dnsEncode, keccak256, toUtf8Bytes } from "ethers/lib/utils";
import { dnsWireFormat } from "../helper/encodednsWireFormat";

import { formatsByCoinType } from "@ensdomains/address-encoder";

describe("L2PublicResolver", () => {
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let l2PublicResolver: L2PublicResolver;

    beforeEach(async () => {
        [user1, user2] = await ethers.getSigners();
        const l2PublicResolverFactory = await ethers.getContractFactory("L2PublicResolver");
        l2PublicResolver = (await l2PublicResolverFactory.deploy()) as L2PublicResolver;
    });

    describe("Clear records", async () => {
        it("can clear records", async () => {
            console.log("addr", user1.address);
            const name = "dm3.eth";
            const node = ethers.utils.namehash("dm3.eth");
            // record should initially be empty
            expect(BigNumber.from(await l2PublicResolver.recordVersions(user1.address, node)).toNumber()).to.equal(0);

            const tx = await l2PublicResolver.connect(user1).clearRecords(dnsEncode(name));
            const receipt = await tx.wait();

            const [textChangedEvent] = receipt.events;

            const [context, eventName, eventNode, recordVersion] = textChangedEvent.args;

            expect(ethers.utils.getAddress(context)).to.equal(user1.address);

            expect(eventName).to.equal(dnsEncode(name));
            expect(eventNode).to.equal(node);
            expect(recordVersion.toNumber()).to.equal(1);

            // record of the owned node should be changed
            expect((await l2PublicResolver.recordVersions(user1.address, node)).toNumber()).to.equal(1);
        });
    });

    describe("TextResolver", () => {
        it("set text record on L2", async () => {
            const name = "dm3.eth";
            const node = ethers.utils.namehash("dm3.eth");
            // record should initially be empty
            expect(await l2PublicResolver.text(user1.address, node, "network.dm3.profile")).to.equal("");

            const tx = await l2PublicResolver.connect(user1).setText(dnsEncode(name), "network.dm3.profile", "test");
            const receipt = await tx.wait();

            const [textChangedEvent] = receipt.events;

            const [context, eventName, eventNode, _, eventKey, eventValue] = textChangedEvent.args;

            expect(ethers.utils.getAddress(context)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventKey).to.equal("network.dm3.profile");
            expect(eventValue).to.equal("test");

            // record of the owned node should be changed
            expect(await l2PublicResolver.text(user1.address, node, "network.dm3.profile")).to.equal("test");
        });
    });

    describe("AddrResolver", () => {
        it("set addr record on L2", async () => {
            const name = "a.b.c.d.dm3.eth";
            const node = ethers.utils.namehash(name);

            // record should initially be empty
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
            const tx = await l2PublicResolver["setAddr(bytes,address)"](dnsEncode(name), user2.address);
            const receipt = await tx.wait();
            const [addressChangedEvent, addrChangedEvent] = receipt.events;

            let [eventContext, eventName, eventNode, eventCoinType, eventAddress] = addressChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventCoinType.toNumber()).to.equal(60);
            expect(ethers.utils.getAddress(eventAddress)).to.equal(user2.address);

            [eventContext, eventName, eventNode, eventAddress] = addrChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(ethers.utils.getAddress(eventAddress)).to.equal(user2.address);
            // record of the owned node should be changed
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(user2.address);
        });
        it("set blockchain address record on L2", async () => {
            const name = "btc.dm3.eth";
            const node = ethers.utils.namehash(name);

            const btcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
            const btcCoinType = 0;
            //See https://github.com/ensdomains/ensjs-v3/blob/c93759f1197e63ca98006f6ef8edada5c4a332f7/packages/ensjs/src/utils/recordHelpers.ts#L43
            const cointypeInstance = formatsByCoinType[btcCoinType];
            const decodedBtcAddress = cointypeInstance.decoder(btcAddress);

            // record should initially be empty
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
            const tx = await l2PublicResolver["setAddr(bytes,uint256,bytes)"](dnsEncode(name), btcCoinType, decodedBtcAddress);
            const receipt = await tx.wait();
            const [addressChangedEvent] = receipt.events;

            let [eventContext, eventName, eventNode, eventCoinType, eventAddress] = addressChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventCoinType.toNumber()).to.equal(0);

            const result = await l2PublicResolver["addr(bytes,bytes32,uint256)"](user1.address, node, btcCoinType);
            console.log(result);

            const encodedBtcAddress = cointypeInstance.encoder(Buffer.from(result.slice(2), "hex"));

            expect(encodedBtcAddress).to.equal(btcAddress);
        });
        it("delegate can set addr record context if approved", async () => {
            const name = "subname.parent.eth";
            const node = ethers.utils.namehash(name);
            const context = user1.address;
            try {
                await l2PublicResolver.connect(user2)["setAddrFor(bytes,bytes,address)"](context, dnsEncode(name), user2.address);
            } catch (e) {
                expect(e.message).to.include("Not authorised");
            }
            // record should be empty
            expect(await l2PublicResolver["addr(bytes,bytes32)"](context, node)).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
            const tx0 = await l2PublicResolver.connect(user1)["approve(bytes,address,bool)"](dnsEncode(name), user2.address, true);
            await tx0.wait();
            const tx = await l2PublicResolver.connect(user2)["setAddrFor(bytes,bytes,address)"](context, dnsEncode(name), user2.address);
            const receipt = await tx.wait();
            const [addressChangedEvent] = receipt.events;
            let [eventContext] = addressChangedEvent.args;
            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(
                user2.address
            );
        });
    });

    describe("ABIResolver", () => {
        it("set abi record on L2", async () => {
            const name = "dm3.eth";
            const node = ethers.utils.namehash(name);

            const abi = l2PublicResolver.interface.format(ethers.utils.FormatTypes.json);
            const tx = await l2PublicResolver.connect(user1).setABI(dnsEncode(name), 1, ethers.utils.toUtf8Bytes(abi.toString()));

            const receipt = await tx.wait();
            const [addressChangedEvent] = receipt.events;

            const [context, eventName, eventNode, eventContentType] = addressChangedEvent.args;

            expect(ethers.utils.getAddress(context)).to.equal(user1.address);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventNode).to.equal(node);
            expect(eventContentType.toNumber()).to.equal(1);

            const [actualContentType, actualAbi] = await l2PublicResolver.ABI(user1.address, node, 1);

            expect(actualContentType.toNumber()).to.equal(1);
            expect(Buffer.from(actualAbi.slice(2), "hex").toString()).to.equal(abi.toString());
        });
    });
    describe("ContentHash", () => {
        it("set contentHash on L2", async () => {
            const name = "dm3.eth";
            const node = ethers.utils.namehash(name);

            const contentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
            const tx = await l2PublicResolver.connect(user1).setContenthash(dnsEncode(name), contentHash);

            const receipt = await tx.wait();
            const [contentHashChangedEvent] = receipt.events;

            const [eventContext, eventName, eventNode, eventHash] = contentHashChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventNode).to.equal(node);
            expect(eventHash).to.equal(eventHash);

            const actualContentHash = await l2PublicResolver.contenthash(user1.address, node);

            expect(actualContentHash).to.equal(contentHash);
        });
    });
    describe("DNS", () => {
        it("set DNS record on L2", async () => {
            const record = dnsWireFormat("a.example.com", 3600, 1, 1, "1.2.3.4");
            const node = ethers.utils.namehash(ethers.utils.nameprep("dm3.eth"));
            const tx = await l2PublicResolver.connect(user1).setDNSRecords(dnsEncode("dm3.eth"), "0x" + record);

            const receipt = await tx.wait();
            const [dnsRecordChangedEvent] = receipt.events;

            const [eventContext, eventNode] = dnsRecordChangedEvent.args;
            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);

            const actualValue = await l2PublicResolver.dnsRecord(user1.address, node, keccak256("0x" + record.substring(0, 30)), 1);

            expect(actualValue).to.equal("0x" + record);
        });
        it("set zonehash on L2", async () => {
            const record = dnsWireFormat("a.example.com", 3600, 1, 1, "1.2.3.4");
            const node = ethers.utils.namehash(ethers.utils.nameprep("dm3.eth"));
            const tx = await l2PublicResolver.connect(user1).setZonehash(dnsEncode("dm3.eth"), keccak256(toUtf8Bytes("foo")));

            const receipt = await tx.wait();
            const [dnsRecordChangedEvent] = receipt.events;

            const [eventContext, eventNode, oldHash, newHash] = dnsRecordChangedEvent.args;
            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(oldHash).to.equal("0x");
            expect(newHash).to.equal(keccak256(toUtf8Bytes("foo")));

            const actualValue = await l2PublicResolver.zonehash(user1.address, node);

            expect(actualValue).to.equal(keccak256(toUtf8Bytes("foo")));
        });
    });

    describe("Name", () => {
        it("set name on L2", async () => {
            const name = "dm3.eth";
            const node = ethers.utils.namehash(name);

            const tx = await l2PublicResolver.connect(user1).setName(dnsEncode(name), "foo");

            const receipt = await tx.wait();
            const [nameChangedEvent] = receipt.events;

            const [eventContext, eventName, eventNode, eventNewName] = nameChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventNode).to.equal(node);
            expect(eventNewName).to.equal("foo");

            const actualName = await l2PublicResolver.name(user1.address, node);

            expect(actualName).to.equal("foo");
        });
    });
});
