SA=lawexpox2ig3wea43hey
echo "== DNS"; getent hosts $SA.blob.core.windows.net
TOKEN=$(curl -s -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://storage.azure.com/" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
H1="Authorization: Bearer $TOKEN"; H2="x-ms-version: 2023-11-03"
echo "== LIST"; curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports?restype=container&comp=list" | grep -o "<Name>[^<]*</Name>"
echo "== current.json"; curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports/2026-01/current.json"; echo
RUN=$(curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports/2026-01/current.json" | python3 -c "import sys,json;print(json.load(sys.stdin)['runId'])")
echo "== manifest"; curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports/2026-01/runs/$RUN/manifest.json"; echo
echo "== csv (hexdump head + text)"; curl -s -H "$H1" -H "$H2" "https://$SA.blob.core.windows.net/exports/2026-01/runs/$RUN/export.csv" | tee /tmp/e.csv | head -c 3 | xxd; cat /tmp/e.csv
echo "== sharedkey attempt"; curl -s -o /dev/null -w "%{http_code}\n" "https://$SA.blob.core.windows.net/exports/2026-01/current.json"
