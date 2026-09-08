"use client";

// Step 26 — live phone input mask. Presentation/typing convenience ONLY:
// it never talks to the server, never touches src/lib/phone.ts, and never
// changes what gets submitted under `name` beyond what the user typed —
// the browser posts this input's current DOM value exactly like any other
// plain <input>, and every server action's existing validation/
// normalization (PHONE_REGEX, normalizePhoneDigits, toWhatsAppPhone) stays
// the sole authority on what is actually accepted/stored.
//
// Deliberately uncontrolled (no `value`/`onChange` prop, `defaultValue`
// only, same as the raw <input>s it replaces): an existing stored value
// (e.g. "0333-1112223", or a non-mobile legacy value like
// "042-35678901") loads and displays byte-for-byte unchanged, and if the
// user never touches the field it submits unchanged too. Reformatting
// only ever happens live, inside the native `input` event, in direct
// response to the user's own typing/backspace/delete/paste — never on
// mount, never on a re-render.
//
// Mask rule: strip everything but digits, then insert one hyphen after
// the 4th digit ("03XX-XXXXXXX"). No digit cap and no other characters
// are rejected here — src/lib/phone.ts's PHONE_REGEX (7-20 chars,
// digits/+/-/spaces/parens) remains the only length/format authority, so
// this can't block a value the server would otherwise accept.
function formatPhoneDisplay(digits: string): string {
  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
}

type PhoneInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onInput">;

export function PhoneInput(props: PhoneInputProps) {
  function handleInput(e: React.FormEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const rawValue = input.value;
    const cursorPos = input.selectionStart ?? rawValue.length;
    // Count digits (not raw characters) before the caret in the
    // pre-reformat value, so the caret can be replanted after the same
    // digit — not the same character index — once the hyphen shifts.
    const digitsBeforeCursor = rawValue.slice(0, cursorPos).replace(/\D/g, "").length;
    const digits = rawValue.replace(/\D/g, "");
    const formatted = formatPhoneDisplay(digits);

    input.value = formatted;

    let newPos = formatted.length;
    if (digitsBeforeCursor === 0) {
      newPos = 0;
    } else {
      let count = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) count++;
        if (count === digitsBeforeCursor) {
          newPos = i + 1;
          break;
        }
      }
    }
    input.setSelectionRange(newPos, newPos);
  }

  return <input {...props} type={props.type ?? "tel"} onInput={handleInput} />;
}
