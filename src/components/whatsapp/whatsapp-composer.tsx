"use client";

// Message preview/selection + real WhatsApp deep link (Step 17 Parts 7–8).
// The tailor picks a template, sees the generated text, may edit it
// freely, then presses "Open WhatsApp" — a plain <a href="https://wa.me/...">
// so it behaves exactly like any other link (new tab, works with
// keyboard/middle-click, no window.open trickery). There is no "sent"
// state anywhere here: once WhatsApp opens, this app has no way to know
// whether the tailor actually pressed send inside it.
import { useState } from "react";
import {
  WHATSAPP_TEMPLATE_IDS,
  buildWhatsAppMessage,
  buildWhatsAppLink,
  type WhatsAppTemplateId,
  type WhatsAppMessageData,
} from "@/lib/whatsapp";
import { en } from "@/lib/locale";

const TEMPLATE_LABELS: Record<WhatsAppTemplateId, string> = {
  confirmation: en.whatsapp.templates.confirmation,
  ready: en.whatsapp.templates.ready,
  reminder: en.whatsapp.templates.reminder,
  delivered: en.whatsapp.templates.delivered,
};

export function WhatsAppComposer({
  phone,
  data,
  defaultTemplate,
}: {
  phone: string;
  data: WhatsAppMessageData;
  defaultTemplate: WhatsAppTemplateId;
}) {
  const [templateId, setTemplateId] = useState<WhatsAppTemplateId>(defaultTemplate);
  const [message, setMessage] = useState(() => buildWhatsAppMessage(defaultTemplate, data));

  function selectTemplate(id: WhatsAppTemplateId) {
    // Switching templates regenerates the text from scratch — the same
    // way choosing a different template in any composer replaces the
    // draft body. Any manual edits since the last switch are discarded;
    // nothing is auto-saved (Step 17 explicitly does not persist edit
    // history).
    setTemplateId(id);
    setMessage(buildWhatsAppMessage(id, data));
  }

  const link = buildWhatsAppLink(phone, message);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink">{en.whatsapp.chooseTemplate}</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {WHATSAPP_TEMPLATE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => selectTemplate(id)}
              aria-pressed={templateId === id}
              className={`rounded-sm border px-3 py-1.5 text-sm transition ${
                templateId === id ? "border-indigo bg-indigo/10 text-indigo" : "border-rule text-graphite hover:bg-paper"
              }`}
            >
              {TEMPLATE_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="whatsapp-message" className="block text-xs font-semibold uppercase tracking-widest text-ink">
          {en.whatsapp.messagePreview}
        </label>
        <textarea
          id="whatsapp-message"
          rows={11}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="mt-2 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
        />
        <p className="mt-1 text-xs text-graphite/50">{en.whatsapp.editHint}</p>
      </div>

      <div>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-sm bg-indigo px-5 py-2.5 text-sm text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2"
        >
          {en.whatsapp.openWhatsApp}
        </a>
        <p className="mt-2 text-xs text-graphite/50">{en.whatsapp.notSentHint}</p>
      </div>
    </div>
  );
}
