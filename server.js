const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// Set these as environment variables before running:
//   GREENHOUSE_SECRET   → your Greenhouse webhook secret key
//   SLACK_WEBHOOK_URL   → your Slack Incoming Webhook URL
//   SLACK_CHANNEL       → e.g. #referrals (optional override)
//   GREENHOUSE_TOKEN    → your Greenhouse API key (for fetching job details)
// ────────────────────────────────────────────────────────────────────────────

const GREENHOUSE_SECRET = process.env.GREENHOUSE_SECRET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || "#referrals";
const GREENHOUSE_TOKEN = process.env.GREENHOUSE_TOKEN;

// Verify the webhook signature from Greenhouse
function verifySignature(req) {
  if (!GREENHOUSE_SECRET) return true; // skip if not configured
  const signature = req.headers["signature"];
  const hmac = crypto
    .createHmac("sha256", GREENHOUSE_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
  return signature === hmac;
}

// Fetch full job details from Greenhouse API
async function fetchJobDetails(jobId) {
  if (!GREENHOUSE_TOKEN) return null;
  const res = await fetch(
    `https://harvest.greenhouse.io/v1/jobs/${jobId}?full_content=true`,
    {
      headers: {
        Authorization:
          "Basic " + Buffer.from(GREENHOUSE_TOKEN + ":").toString("base64"),
      },
    }
  );
  if (!res.ok) return null;
  return res.json();
}

// Build the Slack Block Kit message
function buildSlackMessage(job) {
  const {
    title,
    departments = [],
    offices = [],
    hiring_team = {},
    job_posts = [],
    custom_fields = {},
  } = job;

  const dept = departments[0]?.name || "N/A";
  const hiringManagers = (hiring_team.hiring_managers || [])
    .map((m) => m.name)
    .join(", ") || "N/A";
  const recruiters = (hiring_team.recruiters || [])
    .map((m) => m.name)
    .join(", ") || "N/A";

  // Find the live external job post URL
  const livePost = job_posts.find((p) => p.active && p.external) || job_posts[0];
  const postingUrl = livePost?.absolute_url || "https://app.greenhouse.io";

  // Custom fields — adjust field names to match your Greenhouse setup
  const priority = custom_fields?.priority?.value || custom_fields?.Priority || "N/A";
  const referralBonus =
    custom_fields?.referral_bonus?.value ||
    custom_fields?.["Referral Bonus"] ||
    "N/A";

  // Try to pull requirements from job content
  const requirementsRaw =
    job.notes || job.content || "";
  // Strip HTML tags for preview; you can parse more precisely if needed
  const requirementsText = requirementsRaw
    .replace(/<li>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();

  const requirementsSection = requirementsText
    ? `\n\n*Main Requirements:*\n${requirementsText.substring(0, 600)}${
        requirementsText.length > 600 ? "…" : ""
      }`
    : "";

  return {
    channel: SLACK_CHANNEL,
    text: `🎉 New job posted: *${title}* — we're looking for referrals!`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🎉 New Role — We're Hiring!",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*Title:* ${title}`,
            `*Department:* ${dept}`,
            `*Hiring Manager:* ${hiringManagers}`,
            `*Recruiter:* ${recruiters}`,
            `*Postings:* <${postingUrl}|Careers Page>`,
            `*Priority:* ${priority}`,
            `*Referral Bonus:* ${referralBonus}`,
          ].join("\n") + requirementsSection,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Please submit any referrals into <https://app.greenhouse.io/referrals/new|Greenhouse> and let me know if you have any questions!",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Job Posting", emoji: true },
            url: postingUrl,
            style: "primary",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Submit a Referral",
              emoji: true,
            },
            url: "https://app.greenhouse.io/referrals/new",
          },
        ],
      },
    ],
  };
}

// ─── WEBHOOK ENDPOINT ────────────────────────────────────────────────────────
// Greenhouse will POST to: https://your-server.com/greenhouse-webhook
app.post("/greenhouse-webhook", async (req, res) => {
  // 1. Verify signature
  if (!verifySignature(req)) {
    console.error("Invalid Greenhouse signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const { action, payload } = req.body;

  // 2. Only handle "job_post_published" events
  if (action !== "job_post_published") {
    return res.status(200).json({ message: "Event ignored", action });
  }

  try {
    const jobId = payload?.job?.id;
    if (!jobId) throw new Error("No job ID in payload");

    // 3. Fetch full job details from Greenhouse
    const job = await fetchJobDetails(jobId);
    if (!job) throw new Error("Could not fetch job details");

    // 4. Build and send Slack message
    const slackPayload = buildSlackMessage(job);
    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload),
    });

    if (!slackRes.ok) {
      throw new Error(`Slack returned ${slackRes.status}`);
    }

    console.log(`✅ Slack notified for job: ${job.title} (ID: ${jobId})`);
    res.status(200).json({ success: true, job: job.title });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Greenhouse→Slack webhook listening on :${PORT}`));
