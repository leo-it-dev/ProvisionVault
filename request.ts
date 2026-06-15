export type KrbRequestBody = {
    signature_b64: string | undefined,
    signature_echo: string | undefined
}

export type KrbResponseBody = {
    sign: string | undefined,
    krb5_enc: string | undefined, // base64
    aeskey_bin_tpm: string | undefined // base64
}