import * as wasm from "ergo-lib-wasm-browser";
import JSONBigInt from "json-bigint";

const addressText = document.querySelector("#address");
const balanceErgText = document.querySelector("#balance-erg");

const addressInputBox = document.querySelector("#address-input");
const setSendAddressButton = document.querySelector("#set-send-address");

const sendAddressText = document.querySelector("#send-address");
const sendBalanceErgText = document.querySelector("#send-balance-erg");
const blockHeightText = document.querySelector("#block-height");
const transactionIdText = document.querySelector("#transaction-id");

const connectWalletButton = document.querySelector("#connect");
const sendTransactionButton = document.querySelector("#send");

let reciverWalletAddress = "";
const sendValue = 100000000;

let accessGranted = false;

async function getCurrentHeight() {
    let url = "https://api.ergoplatform.com/api/v1/blocks?limit=1";
    return await fetch(url)
        .then(res => res.json())
        .then(data => { return data["total"]; })
}

setSendAddressButton.addEventListener('click', (e) => {
    sendAddressText.innerHTML = addressInputBox.value;
    reciverWalletAddress = addressInputBox.value;
});

connectWalletButton.addEventListener('click', (e) => {
    ergoConnector.nautilus.connect().then(granted => {
        if (granted) {
            accessGranted = true;
            updateWalletInfo();
        } else {
            accessGranted = false;
        }
    })
});

sendTransactionButton.addEventListener('click', async (e) => {
    if (!accessGranted) {
        alert("Connect wallet first!");
        return;
    }

    ergo.get_balance().then(async function(balance) {
        async function getUtxos(amountToSend) {
            const fee = BigInt(wasm.TxBuilder.SUGGESTED_TX_FEE().as_i64().to_str());
            const fullAmount = BigInt(1000) * amountToSend + fee;
            console.log(fullAmount);
            const utxos = await ergo.get_utxos(fullAmount.toString());
            const filteredUtxos = [];
            for (const utxo of utxos) {
                try {
                    await wasm.ErgoBox.from_json(JSONBigInt.stringify(utxo));
                    filteredUtxos.push(utxo);
                } catch (e) {
                    console.log('[getUtxos] UTXO failed parsing: ', utxo, e);
                }
            }
            return filteredUtxos;
        }

        const creationHeight = await getCurrentHeight();
        blockHeightText.innerHTML = creationHeight;
        console.log(creationHeight);

        const amountToSend = BigInt(sendValue);
        const amountToSendBoxValue = wasm.BoxValue.from_i64(wasm.I64.from_str(amountToSend.toString()));
        const utxos = await getUtxos(amountToSend);
        let utxosValue = utxos.reduce((acc, utxo) => acc += BigInt(utxo.value), BigInt(0));
        console.log('utxos', utxosValue, utxos);

        const changeValue = utxosValue - amountToSend - BigInt(wasm.TxBuilder.SUGGESTED_TX_FEE().as_i64().to_str());
        console.log(`${changeValue} | cv.ts() = ${changeValue.toString()}`);
        const changeAddr = await ergo.get_change_address();
        console.log(`changeAddr = ${JSON.stringify(changeAddr)}`);

        const selector = new wasm.SimpleBoxSelector();
        const boxSelection = selector.select(
            wasm.ErgoBoxes.from_boxes_json(utxos),
            wasm.BoxValue.from_i64(amountToSendBoxValue.as_i64().checked_add(wasm.TxBuilder.SUGGESTED_TX_FEE().as_i64())),
            new wasm.Tokens());
        console.log(`boxes selected: ${boxSelection.boxes().len()}`);

        const outputCandidates = wasm.ErgoBoxCandidates.empty();

        const outBoxBuilder = new wasm.ErgoBoxCandidateBuilder(
            amountToSendBoxValue,
            wasm.Contract.pay_to_address(wasm.Address.from_base58(reciverWalletAddress)),
            creationHeight);

        try {
            outputCandidates.add(outBoxBuilder.build());
        } catch (e) {
            console.log(`building error: ${e}`);
            throw e;
        }
        console.log(`utxosvalue: ${utxosValue.toString()}`);

        const txBuilder = wasm.TxBuilder.new(
            boxSelection,
            outputCandidates,
            creationHeight,
            wasm.TxBuilder.SUGGESTED_TX_FEE(),
            wasm.Address.from_base58(changeAddr),
            wasm.BoxValue.SAFE_USER_MIN());
        const dataInputs = new wasm.DataInputs();
        txBuilder.set_data_inputs(dataInputs);

        console.log(txBuilder.build().to_json());

        const tx = parseTransactionData(txBuilder.build().to_json());

        console.log(`tx: ${JSONBigInt.stringify(tx)}`);
        console.log(`original id: ${tx.id}`);

        const correctTx = parseTransactionData(wasm.UnsignedTransaction.from_json(JSONBigInt.stringify(tx)).to_json());
        console.log(`correct tx: ${JSONBigInt.stringify(correctTx)}`);
        console.log(`new id: ${correctTx.id}`);
        
        correctTx.inputs = correctTx.inputs.map(box => {
            console.log(`box: ${JSONBigInt.stringify(box)}`);
            const fullBoxInfo = utxos.find(utxo => utxo.boxId === box.boxId);
            return {
                ...fullBoxInfo,
                extension: {}
            };
        });
        console.log(`${JSONBigInt.stringify(correctTx)}`);                    

        async function signTx(txToBeSigned) {
            try {
                return await ergo.sign_tx(txToBeSigned);
            } catch (err) {
                const msg = `[signTx] Error: ${JSON.stringify(err)}`;
                console.error(msg, err);
                return null;
            }
        }

        async function submitTx(txToBeSubmitted) {
            try {
                return await ergo.submit_tx(txToBeSubmitted);
            } catch (err) {
                const msg = `[submitTx] Error: ${JSON.stringify(err)}`;
                console.error(msg, err);
                return null;
            }
        }

        async function processTx(txToBeProcessed) {
            const msg = s => {
                console.log('[processTx]', s);
            };
            const signedTx = await signTx(txToBeProcessed);
            if (!signedTx) {
                console.log(`No signed tx`);
                return null;
            }
            msg("Transaction signed - awaiting submission");
            const txId = await submitTx(signedTx);
            if (!txId) {
                console.log(`No submotted tx ID`);
                return null;
            }
            msg("Transaction submitted - thank you for your donation!");
            return txId;
        }

        processTx(correctTx).then(txId => {
            console.log('[txId]', txId);
            if (txId) {
                transactionIdText.innerHTML = txId;
                let url = "https://explorer.ergoplatform.com/en/transactions/" + txId;
                transactionIdText.href = url;
            }
        });
    })
})

function updateWalletInfo() {
    updateAddressText();
    updateBalances();
}

function updateAddressText() {
    ergo.get_change_address().then(addr => {
        addressText.innerHTML = addr;
    });
}

function updateBalances() {
    ergo.get_balance().then(bal => {
        balanceErgText.innerHTML = bal / 1000000000;
        sendBalanceErgText.innerHTML = sendValue / 1000000000;
    });
}

function parseTransactionData(str) {
    let json = JSONBigInt.parse(str);
    return {
        id: json.id,
        inputs: json.inputs,
        dataInputs: json.dataInputs,
        outputs: json.outputs.map(output => parseUTXO(output)),
    }
}

function parseUTXO(json) {
    var newJson = { ...json };
    if (newJson.assets === null) {
        newJson.assets = [];
    }
    return {
        boxId: newJson.boxId,
        value: newJson.value.toString(),
        ergoTree: newJson.ergoTree,
        assets: newJson.assets.map(asset => ({
            tokenId: asset.tokenId,
            amount: asset.amount.toString(),
        })),
        additionalRegisters: newJson.additionalRegisters,
        creationHeight: newJson.creationHeight,
        transactionId: newJson.transactionId,
        index: newJson.index
    };
}