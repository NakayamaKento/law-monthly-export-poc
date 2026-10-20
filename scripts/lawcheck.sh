LAW=<LOG_ANALYTICS_WORKSPACE_ID>
echo "== DNS api"; getent hosts api.loganalytics.azure.com | head -2
TOKEN=$(curl -s -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://api.loganalytics.io" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "VM MI has no LAW role -> expect 403 first:"; 
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"query":"AzureActivity | where TimeGenerated >= datetime(2026-09-30T15:00:00) and TimeGenerated < datetime(2026-10-31T15:00:00) | count"}' "https://api.loganalytics.azure.com/v1/workspaces/$LAW/query"; echo
echo "total any time:"; curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"query":"AzureActivity | summarize n=count(), mn=min(TimeGenerated), mx=max(TimeGenerated)"}' "https://api.loganalytics.azure.com/v1/workspaces/$LAW/query"; echo
