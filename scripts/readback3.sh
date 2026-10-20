SA=lawexpox2ig3wea43hey
TOKEN=$(curl -s -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://storage.azure.com/" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
H1="Authorization: Bearer $TOKEN"; H2="x-ms-version: 2023-11-03"
M=2026-10
RUN=$(curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports/$M/current.json" | python3 -c "import sys,json;print(json.load(sys.stdin)['runId'])")
echo "current=$RUN"
curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports/$M/runs/$RUN/manifest.json" | python3 -c "import sys,json;d=json.load(sys.stdin);print('rowCount',d['rowCount'])"
curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports/$M/runs/$RUN/export.csv" | python3 -c "import sys;b=sys.stdin.buffer.read();print(b.decode('utf-8-sig').encode('unicode_escape').decode())"
