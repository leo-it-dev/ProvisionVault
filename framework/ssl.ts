import * as fs from 'node:fs';
import * as https from 'https';
import { getLogger } from './logger';
import config from 'config';

export let CA_CERT: string = "";
export let ADFS_CERT: string = "";
export let sslCertificate: string = "";
export let sslPrivateKey: string = "";

export const SSL_OPTIONS = {
    key: '<uninitialized>',
    cert: '<uninitialized>',
};

const logger = getLogger('ssl');
export const SSL_FOLDER_PATH = __dirname + '/../ssl/';

export function initSSL() {
    if (config.has("generic.SSL_CERTIFICATE_FILENAME") && config.has("generic.SSL_PRIVKEY_FILENAME")) {
        sslCertificate = String(fs.readFileSync(SSL_FOLDER_PATH + config.get('generic.SSL_CERTIFICATE_FILENAME'), { encoding: 'utf-8' }));
        sslPrivateKey = String(fs.readFileSync(SSL_FOLDER_PATH + config.get('generic.SSL_PRIVKEY_FILENAME'), { encoding: 'utf-8' }));

        SSL_OPTIONS.key = sslPrivateKey;
        SSL_OPTIONS.cert = sslCertificate;
    }
}

export function httpsRequest(hostname: string, path: string, method: string, body: string, contentType?: string, authorization?: string): Promise<{ 'statusCode': number, 'data': string }> {
    return new Promise<{ 'statusCode': number, 'data': string }>((res, rej) => {
        logger.debug("Performing https request!", { hostname: hostname, path: path, method: method });
        let reqHeaders = {};
        if (contentType) {
            reqHeaders = { 'content-type': contentType };
        }
        if (authorization) {
            reqHeaders = { ...reqHeaders, 'Authorization': authorization };
        }

        reqHeaders = {
            ...reqHeaders,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
            "Accept": "application/json",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Pragma": "no-cache",
            "Cache-Control": "no-cache",
            "content-length": body.length
        };

        const requ = https.request({
            hostname: hostname,
            path: path,
            method: method,
            headers: reqHeaders,
            cert: ADFS_CERT,
            ca: CA_CERT
        }, (response) => {
            let data = "";
            response.on('data', (chunk) => data += chunk.toString());
            response.on('error', (err) => {
                logger.error("Received error while trying to perform SSL https request!", { hostname: hostname, path: path, method: method, body: body, contenetType: contentType, authorization: authorization, error: err });
                rej(err);
            });
            response.on('end', () => {
                res({ 'statusCode': response.statusCode!, 'data': data });
            });
        });
        requ.write(body);
        requ.end();
    });
}