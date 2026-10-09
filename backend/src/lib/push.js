import { supabase } from "./supabase.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function sendArticlePush(article) {
  try {
    const { data: devices, error } = await supabase.from("devices").select("fcm_token");
    if (error) throw error;
    const tokens = [...new Set((devices || []).map(item => item.fcm_token)
      .filter(token => typeof token === "string" && /^(Expo|Exponent)PushToken\[/.test(token)))];
    if (!tokens.length) return { sent: 0 };

    const messages = tokens.map(to => ({
      to,
      sound: "default",
      title: article.title,
      body: article.access_type === "PREMIUM"
        ? "New premium market research is available."
        : "Read the latest market research from BazaarNexa.",
      data: { articleSlug: article.slug, articleId: article.id, category: article.category_name || null },
      channelId: "market-research",
      priority: "high"
    }));

    let accepted = 0;
    for (let offset = 0; offset < messages.length; offset += 100) {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(messages.slice(offset, offset + 100))
      });
      if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
      const result = await response.json();
      const tickets = Array.isArray(result.data) ? result.data : [result.data];
      accepted += tickets.filter(ticket => ticket?.status === "ok").length;
    }
    console.info("Article push result:", { targetCount: tokens.length, accepted });
    return { sent: accepted, targetCount: tokens.length };
  } catch (error) {
    console.error("Article push failed:", error instanceof Error ? error.message : error);
    return { sent: 0, error: "push_delivery_failed" };
  }
}
