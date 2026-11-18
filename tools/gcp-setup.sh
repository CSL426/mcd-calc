#!/usr/bin/env bash
# 一次性：開 GCP 專案，讓 GitHub Actions 用 Workload Identity Federation（免金鑰）部署到 Cloud Run。
# image 直接從 ghcr.io 的公開 image 拉，所以不建 Artifact Registry、GCP 上不存 image。
#
# 用法（在已經 `gcloud auth login` 的機器上）：
#   PROJECT_ID=mcd-calc-csl426 BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX bash tools/gcp-setup.sh
# 帳單帳戶 ID 用 `gcloud billing accounts list` 查。重跑是安全的：已經存在的東西會跳過。
set -euo pipefail

: "${PROJECT_ID:?請設定 PROJECT_ID，例如 mcd-calc-csl426（全球唯一、6–30 字元）}"
: "${BILLING_ACCOUNT:?請設定 BILLING_ACCOUNT（gcloud billing accounts list 的 ACCOUNT_ID）}"
REGION="${REGION:-asia-east1}"
GITHUB_REPO="${GITHUB_REPO:-CSL426/mcd-calc}"
SA_NAME="github-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL="github"
PROVIDER="github-oidc"

step() { printf '\n== %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

step "1. 專案與帳單"
if exists gcloud projects describe "$PROJECT_ID"; then
  echo "專案 $PROJECT_ID 已存在，略過建立"
else
  gcloud projects create "$PROJECT_ID" --name="mcd-calc"
fi
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
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
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
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
