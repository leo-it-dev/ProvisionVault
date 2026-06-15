import express from 'express';
import * as https from 'https';
const serv = express();
import * as path from 'path';
import * as fs from 'fs';
import * as ssl from './framework/ssl';
import { getLogger } from './framework/logger';
import config from 'config';
import { KrbRequestBody } from './request';
import * as crypto from 'crypto';
import * as lru from 'lru-cache';

let mainLogger = getLogger("index");

const NONCE_TIMEOUT_MILLIS = 1000 * 60 * (config.get('generic.KRB_SIGN_TIMEOUT_MINUTES') as number);
let nonceCache = new lru.LRUCache({
    max: 1000,
    ttl: NONCE_TIMEOUT_MILLIS
})

let keysMap = new Map<string, string>;


// Change directory to project root (ts-files)
const projectRoot = path.resolve('./');
process.chdir(projectRoot);
console.log(process.cwd())
__dirname = projectRoot;

function initializeDevelopmentBuildEnvironment(projectRoot: string) {
    const logger = getLogger("dev-init");
    logger.info("--- Preparing development environment ---");
    let runtimeRoot = path.join(projectRoot, 'build');

    let copyPaths = [
        {
            src: path.join(projectRoot, 'ssl'),
            dest: path.join(runtimeRoot, 'ssl'),
            forceOverwrite: true
        }
    ]
    
    for (let copyPath of copyPaths) {
        if (!fs.existsSync(copyPath.dest) || copyPath.forceOverwrite) {
            logger.info("    - Copying path ", { src: copyPath.src, dst: copyPath.dest });
            fs.cpSync(copyPath.src, copyPath.dest, { recursive: true });
        }
    }

    logger.info("--- Preparing development environment finished ---");
}

initializeDevelopmentBuildEnvironment(projectRoot);
ssl.initSSL();

const httpsPort = config.get('generic.HTTPS_PORT') as number;
let httpsServer = https.createServer(ssl.SSL_OPTIONS, serv);

serv.use(express.json())


for(let machineId of fs.readdirSync(path.join(projectRoot, "machine-data"))) {
    let machinePath = path.join(projectRoot, "machine-data", machineId);
    let machinePublicKey = fs.readFileSync(path.join(machinePath, 'public.pem'), 'utf-8');
    keysMap.set(machineId, machinePublicKey);
}

serv.post('/krb', (req, res) => {
    let body: KrbRequestBody = req.body;

    if (body.signature_b64 === undefined) {
        let nonceSign = crypto.randomBytes(128).toString('base64');
        nonceCache.set(nonceSign, {created: Date.now()});
        res.send(JSON.stringify({"sign": nonceSign})).status(200);
    } else {
        if (body.signature_echo === undefined) {
            res.status(400).send(JSON.stringify({error: "No signature echo supplied!"}));
            return;
        }

        let nonceEcho = body.signature_echo as string;

        let nonceEntry = nonceCache.get(nonceEcho) as any;
        if (!nonceEntry) {
            res.status(400).send(JSON.stringify({error: "No valid nonce found!"}));
            return;
        }
        if (Date.now() - nonceEntry['created'] > NONCE_TIMEOUT_MILLIS) {
            res.status(400).send(JSON.stringify({error: "Nonce not valid anymore!"}));
            return;
        }


        let machineIdFound = undefined;

        for(let [machineId, publicKey] of keysMap.entries()) {
            try {
                let tpmSignature = body.signature_b64;
                let verify = crypto.createVerify('RSA-SHA256');
                verify.update(nonceEcho);
                let signatureIsValid = verify.verify(publicKey, tpmSignature, 'base64');
                if (signatureIsValid) {
                    machineIdFound = machineId;
                    break;
                }
            } catch(err) {}
        }

        if (machineIdFound) {
            let aeskey_enc = fs.readFileSync(path.join(projectRoot, "machine-data", machineIdFound, "aeskey.bin.tpm"), 'base64');
            let krb5_enc = fs.readFileSync(path.join(projectRoot, "machine-data", machineIdFound, "krb5.enc"), 'base64');
            let hostname = fs.readFileSync(path.join(projectRoot, "machine-data", machineIdFound, "hostname"), 'ascii');

            res.status(200).send(JSON.stringify({success: true, machineId: machineIdFound, data: {aeskey_enc: aeskey_enc, krb5_enc: krb5_enc, hostname: hostname}}));
            nonceCache.delete(nonceEcho);
        } else {
            res.status(400).send(JSON.stringify({error: "Could not validate signature against any client machine!"}));
            return;
        }
    }
});

async function startup() {
    httpsServer.listen(httpsPort, '0.0.0.0');
}

startup();
mainLogger.info("Server started up and running on ", {serverport: httpsPort, hostname: "0.0.0.0"});
