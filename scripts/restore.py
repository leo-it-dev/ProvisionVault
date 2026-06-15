import requests
import json
import subprocess
import base64
import time
import os
import re
from hashlib import sha256

if not 'REALM' in os.environ or not 'PROVVAULT' in os.environ or not 'SMBSERV' in os.environ:
        print("Missing some environment variables! Did you run 'source ./script-env' beforehand or set EnvironmentFile= in systemd service?")
        quit()

def spawn_proc(args):
        lines = []
        proc = subprocess.Popen(args, stdout=subprocess.PIPE)
        while True:
                line = proc.stdout.readline()
                if not line:
                        break
                lines.append(line)
        return lines

url = f'https://{os.environ["PROVVAULT"]}:444/krb'
data = ''
response = requests.post(url, data=data, verify='pxe-provider-bundle.crt', headers={"Content-Type": "application/json"})

if response.status_code == 200:
        body = json.loads(response.text)
        sign_request = body['sign']

        print("Signature request:", sign_request)
        print()

        sign_in_file = "/tmp/sign_" + str(time.time() * 1000) + ".txt"
        sign_out_file = "/tmp/out_" + str(time.time() * 1000) + ".sig"
        open(sign_in_file, "w").write(sign_request)
        spawn_proc(['tpm2_sign', '-o', sign_out_file, '-g', 'sha256', '-c', '0x81010001', '--format', 'plain', sign_in_file])
        signature_data = open(sign_out_file, "br").read()
        signature_base64 = base64.b64encode(signature_data).decode('ascii')
        print("Signature response:", signature_base64)
        print()

        data = '{"signature_b64": "' + signature_base64 + '", "signature_echo":' + json.dumps(sign_request) + '}'
        print("Sending signed krb request:", data)
        response = requests.post(url, data=data, verify='pxe-provider-bundle.crt', headers={"Content-Type": "application/json"})

        if response.status_code == 200:
                response_data = json.loads(response.text)
                aeskey_encrypted = base64.b64decode(response_data['data']['aeskey_enc'])
                krb5_encrypted = base64.b64decode(response_data['data']['krb5_enc'])
                aeskey_enc_tmp = "/tmp/aeskey_" + str(time.time() * 1000) + ".bin.enc"
                aeskey_tmp = "/tmp/aeskey_" + str(time.time() * 1000) + ".bin"
                keytab_enc_tmp = "/tmp/krb5_" + str(time.time() * 1000) + ".keytab.enc"

                open(aeskey_enc_tmp, "wb").write(aeskey_encrypted)
                open(keytab_enc_tmp, "wb").write(krb5_encrypted)
                spawn_proc(['tpm2_rsadecrypt', '-c', '0x81010001', '-o', aeskey_tmp, aeskey_enc_tmp])
                aeskey_decrypted = open(aeskey_tmp, "rb").read()
                hostname = response_data['data']['hostname']

                spawn_proc([ 'hostnamectl', 'hostname', hostname ])

                print(spawn_proc(['hostnamectl', 'hostname']))

                spawn_proc([
                        'openssl', 'enc', '-d', '-aes-256-cbc', '-md', 'sha512', '-pbkdf2', '-iter', '1000000', '-salt',
                        '-out', '/etc/krb5-overlay/krb5.keytab', '-pass', 'file:' + aeskey_tmp, '-in', keytab_enc_tmp
                ])
                spawn_proc([
                        'chmod', '700', '/etc/krb5-overlay/krb5.keytab'
                ])

                os.remove(aeskey_enc_tmp)
                os.remove(aeskey_tmp)

                klist = [s.decode('ascii') for s in spawn_proc(['klist', '-k', '/etc/krb5-overlay/krb5.keytab'])]
                pattern = re.compile(r'host\/(.*)@.*')
                m = [pattern.search(line) for line in klist]
                print(m)
                principal = [principal.group(1) for principal in m if principal is not None][0]
                print("Principal: ", principal)

                spawn_proc([
                        'kinit', '-k', '-t', '/etc/krb5-overlay/krb5.keytab', principal + '$'
                ])
                spawn_proc([
                        'mount', '-v', '-t', 'cifs', f'//{os.environ["SMBSERV"]}/linux', '/mnt/server_linux', '-o', 'sec=krb5,serverino'
                ])

        else:
                print("Error received from server:", response.status_code, response.text)

        os.remove(sign_in_file)
        os.remove(sign_out_file)

else:
        print("Server reported error: ", response.text)
