export PATH=$PATH:/usr/sbin

source /root/script-env

STORAGE_SLOT=0x81010002

tpm2_getcap handles-persistent | grep $STORAGE_SLOT
if [ $? -eq 0 ]; then
        echo "Looks like machine is already provisioned!"
        echo "Delete old keypair and regenerate? [Warning: This results in machine being unable to access AD anymore until reprovisioned.]"
        echo "> (y/N):"
        read reprovision

        if [ "$reprovision" = "y" ]; then
                echo "Deleting old keypair..."
                tpm2_evictcontrol -c $STORAGE_SLOT
                if [ $? -eq 0 ]; then
                        echo "Successfully deleted old key from TPM storage!"
                else
                        echo "Error deleting old key from TPM storage, exiting!"
                        exit 2
                fi
        else
                echo "Exiting."
                exit 1
        fi
fi

# Create object root reference context
tpm2_createprimary -C o -c prim.ctx
# Create a rsa public/private keypair. (Stored priv is not the key itself, but rather an encrypted representation only readable by the tpm itself)
tpm2_create -C prim.ctx -G rsa2048 -u client.pub -r client.priv -a "fixedtpm|fixedparent|sensitivedataorigin|userwithauth|sign|decrypt"
# Load generated keypair into tpm volatile memory and store context to access it later on
tpm2_load -C prim.ctx -u client.pub -r client.priv -c client.ctx
# Store keypair in persistent TPM memory slot, user usable slots ususally start at 0x81010000, so we use $STORAGE_SLOT and hope it is free to use.
tpm2_evictcontrol -C o -c client.ctx $STORAGE_SLOT
# Delete private key from storage
rm client.priv client.pub prim.ctx client.ctx
# Export public key in machine usable PEM format.
tpm2_readpublic -c $STORAGE_SLOT -f pem -o public.pem
openssl pkey -pubin -in public.pem -outform der | sha256sum -z | tr -d ' -' > machine_id

# ---- Cool. Now configure this host with a unique hostname before joining the AD
echo -n "Enter hostname for this machine: "
read hostname
echo "Alright. This machine will use hostname: $hostname"
hostnamectl hostname $hostname
echo $hostname > hostname

# ------ Great we prepared our tpm. Next let's jour our AD and proceed with securing the keytab.
adcli join $REALM
# We now have our keytab stored under /etc/krb5-overlay/krb5.keytab. We now encrypt the keytab using a random 32-byte aes key
openssl rand 32 > aeskey.bin
openssl enc -aes-256-cbc -md sha512 -pbkdf2 -iter 1000000 -salt -in /etc/krb5-overlay/krb5.keytab -out krb5.enc -pass file:aeskey.bin
# Great, we encrypted our keytab file. Now we ask our TPM to encrypt the symmetrical aes256 key using it's safely stored private key.
tpm2_rsaencrypt -c $STORAGE_SLOT -o aeskey.bin.tpm aeskey.bin
rm aeskey.bin

echo "Done provisioning TPM and AD connection. All files (aeskey.bin.tpm, krb5.enc, machine_id, public.pem, hostname) can now be transfered to the server."

echo Done.
