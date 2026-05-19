# Greenhouse → Slack Referral Webhook

Automatically posts to a Slack channel whenever a job goes live on your Greenhouse job board.

---

## How it works

1. A recruiter publishes a job posting in Greenhouse
2. Greenhouse fires a `job_post_published` webhook to your server
3. The server fetches full job details from the Greenhouse Harvest API
4. A formatted Slack message is sent to your referrals channel

---

## Setup

### 1. Deploy the server

Any Node.js host works: Railway, Render, Heroku, Fly.io, etc.

```bash
npm install
npm start
```

Set these environment variables:

| Variable | Description |
|---|---|
| `GREENHOUSE_SECRET` | Webhook secret from Greenhouse (for signature verification) |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |
| `SLACK_CHANNEL` | Channel to post to, e.g. `#referrals` |
| `GREENHOUSE_TOKEN` | Greenhouse Harvest API key (read-only is fine) |
| `PORT` | Server port (defaults to 3000) |

---

### 2. Create a Slack Incoming Webhook

1. Go to https://api.slack.com/apps → **Create New App** → From scratch
2. Name it "Greenhouse Referrals" and pick your workspace
3. Under **Features**, click **Incoming Webhooks** → toggle on
4. Click **Add New Webhook to Workspace** → pick your `#referrals` channel
5. Copy the webhook URL → set as `SLACK_WEBHOOK_URL`

---

### 3. Configure Greenhouse webhook

1. In Greenhouse, go to **Configure** → **Dev Center** → **Web Hooks**
2. Click **+ New Web Hook**
3. Set:
   - **Name**: Slack Referral Notifier
   - **Endpoint URL**: `https://your-server.com/greenhouse-webhook`
   - **Secret Key**: any random string → also set as `GREENHOUSE_SECRET`
   - **When**: `Job Post Published`
4. Save

---

### 4. Map custom fields (optional)

In `server.js`, the `buildSlackMessage` function reads custom fields for Priority and Referral Bonus. Update the field names to match your Greenhouse setup:

```js
const priority = custom_fields?.priority?.value || custom_fields?.Priority || "N/A";
const referralBonus = custom_fields?.referral_bonus?.value || custom_fields?.["Referral Bonus"] || "N/A";
```

To find your exact field names, hit the Greenhouse API:
```
GET https://harvest.greenhouse.io/v1/jobs/{job_id}
```
and inspect the `custom_fields` object.

---

### 5. Test it

Send a test payload to your server:

```bash
curl -X POST https://your-server.com/greenhouse-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "action": "job_post_published",
    "payload": {
      "job": { "id": 12345 }
    }
  }'
```

---

## Slack message format

The message includes:
- Job title, department, hiring manager, recruiter
- Link to careers page posting
- Priority and referral bonus (from custom fields)
- Main requirements (pulled from job content)
- Buttons: "View Job Posting" and "Submit a Referral"
