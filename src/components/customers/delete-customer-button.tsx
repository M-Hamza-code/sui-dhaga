"use client";

// Client component only for the confirm() prompt — the actual deletion is
// the server action passed in via `action`, already bound to the
// customer's id by the caller.
export function DeleteCustomerButton({
  action,
  customerName,
}: {
  action: (formData: FormData) => Promise<void>;
  customerName: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Delete ${customerName}? They will be removed from customer lists and search, but their record is kept.`
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-sm border border-red-300 px-4 py-2 text-sm text-red-700 transition hover:bg-red-50"
      >
        Delete Customer
      </button>
    </form>
  );
} 
