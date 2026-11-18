#!/usr/bin/env bash
# 一次性：讓 GitHub Actions 用 Workload Identity Federation（免金鑰）把這個 repo 部署到 Cloud Run。
# image 直接從 ghcr.io 的公開 image 拉，所以不建 Artifact Registry、GCP 上不存 image。
#
# 用法（在已經 `gcloud auth login` 的機器上），兩種情況：
#   加進既有專案（小專案共用一個 GCP 專案、各自一個 Cloud Run 服務）：
#     PROJECT_ID=csl-portfolio SA_NAME=mcd-calc-deployer PROVIDER=github-oidc-mcd-calc bash tools/gcp-setup.sh
#   開新專案（要給帳單帳戶，`gcloud billing accounts list` 查）：
#     PROJECT_ID=新的專案ID BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX bash tools/gcp-setup.sh
# 重跑是安全的：已經存在的東西會跳過。
# 用自己的部署帳號和 provider，不改同專案其他服務原本的 WIF 設定。
set -euo pipefail

: "${PROJECT_ID:?請設定 PROJECT_ID}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
REGION="${REGION:-asia-east1}"
GITHUB_REPO="${GITHUB_REPO:-CSL426/mcd-calc}"
SA_NAME="${SA_NAME:-github-deployer}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL="${POOL:-github}"
PROVIDER="${PROVIDER:-github-oidc}"

step() { printf '\n== %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

step "1. 專案與帳單"
if exists gcloud projects describe "$PROJECT_ID"; then
  echo "專案 $PROJECT_ID 已存在，略過建立與帳單"
else
  : "${BILLING_ACCOUNT:?開新專案要設定 BILLING_ACCOUNT（gcloud billing accounts list 的 ACCOUNT_ID）}"
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_ID"
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
fi
gcloud config set project "$PROJECT_ID"

step "2. 啟用 API（Cloud Run、IAM credentials、STS）"
gcloud services enable run.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

step "3. 部署用 service account"
if ! exists gcloud iam service-accounts describe "$SA_EMAIL"; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deployer"
fi
# run.admin：部署並開放匿名瀏覽；serviceAccountUser：讓 Cloud Run 用預設執行身分
for ROLE in roles/run.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE" --condition=None >/dev/null
done

step "4. Workload Identity Federation（只允許 ${GITHUB_REPO}）"
if ! exists gcloud iam workload-identity-pools describe "$POOL" --location=global; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
fi
if ! exists gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL"; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}'"
fi
# 不用 --format='value(...)'：Windows 的 gcloud.cmd 會吃掉括號，結果變空字串
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" | sed -n "s/^projectNumber: *'\{0,1\}\([0-9]*\).*/\1/p")
[ -n "$PROJECT_NUMBER" ] || { echo "取不到 $PROJECT_ID 的 projectNumber" >&2; exit 1; }
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" \
  >/dev/null

step "完成。把下面三個值設成 GitHub repo 的 Actions variables（不是機密，可以放 variables）："
cat <<EOF
GCP_PROJECT_ID=${PROJECT_ID}
GCP_SA_EMAIL=${SA_EMAIL}
GCP_WIF_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}
EOF
