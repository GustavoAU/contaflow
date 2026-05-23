"use client";
// src/modules/ai-assistant/components/AIAssistantChat.tsx

import { useState, useRef, useTransition, useEffect } from "react";
import { SendIcon, ImageIcon, BotIcon, UserIcon, ShieldCheckIcon, XIcon, SparklesIcon } from "lucide-react";
import { sendMessageAction } from "../actions/ai-assistant.actions";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imagePreview?: string;
  isAuditMode?: boolean;
};

type Props = {
  companyId: string;
  companyName: string;
};

const SUGGESTIONS = [
  "¿Cuánto IVA debo declarar este mes?",
  "¿Quién me debe más dinero?",
  "Auditar el período actual",
  "¿Cómo va mi flujo de caja?",
  "Sugiere un asiento por pago de nómina",
];

export function AIAssistantChat({ companyId, companyName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [imageBase64, setImageBase64] = useState<string | undefined>();
  const [imagePreview, setImagePreview] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPending]);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      // Strip data URL prefix → solo base64
      const base64 = result.split(",")[1];
      setImageBase64(base64);
      setImagePreview(result);
    };
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setImageBase64(undefined);
    setImagePreview(undefined);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg && !imageBase64) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: msg,
      imagePreview,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    clearImage();

    startTransition(async () => {
      const result = await sendMessageAction(companyId, msg, imageBase64);
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.success
          ? result.reply
          : `Error: ${result.error}`,
        isAuditMode: result.success ? result.isAuditMode : false,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-zinc-200 px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100">
          <SparklesIcon className="h-5 w-5 text-violet-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-zinc-800">ContaFlow IA</p>
          <p className="text-xs text-zinc-500">Asistente contable venezolano</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {companyName}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-6 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-50">
              <BotIcon className="h-8 w-8 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-700">Pregunta sobre tu contabilidad</p>
              <p className="mt-1 text-xs text-zinc-400">
                Tengo acceso a los datos de{" "}
                <span className="font-medium text-zinc-600">{companyName}</span>{" "}
                en tiempo real
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  disabled={isPending}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
                {msg.isAuditMode ? (
                  <ShieldCheckIcon className="h-4 w-4 text-violet-600" />
                ) : (
                  <BotIcon className="h-4 w-4 text-violet-600" />
                )}
              </div>
            )}

            <div className={`max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
              {msg.imagePreview && (
                <img
                  src={msg.imagePreview}
                  alt="Imagen adjunta"
                  className="max-h-40 rounded-lg object-contain border border-zinc-200"
                />
              )}
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-violet-600 text-white"
                    : msg.isAuditMode
                    ? "bg-amber-50 border border-amber-200 text-zinc-800"
                    : "bg-zinc-100 text-zinc-800"
                }`}
              >
                {msg.content}
              </div>
            </div>

            {msg.role === "user" && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200">
                <UserIcon className="h-4 w-4 text-zinc-600" />
              </div>
            )}
          </div>
        ))}

        {isPending && (
          <div className="flex gap-3 justify-start">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
              <BotIcon className="h-4 w-4 text-violet-600" />
            </div>
            <div className="rounded-2xl bg-zinc-100 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex gap-1 items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-zinc-400">Analizando tus datos…</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-200 px-4 py-3">
        {imagePreview && (
          <div className="mb-2 flex items-center gap-2">
            <img
              src={imagePreview}
              alt="Vista previa"
              className="h-12 w-12 rounded-lg object-cover border border-zinc-200"
            />
            <button
              onClick={clearImage}
              className="rounded-full p-1 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isPending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition-colors hover:border-violet-300 hover:text-violet-600 disabled:opacity-50"
            title="Adjuntar imagen"
          >
            <ImageIcon className="h-4 w-4" />
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
          />

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Escribe tu pregunta contable..."
            rows={1}
            disabled={isPending}
            className="flex-1 resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 disabled:opacity-50"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />

          <button
            onClick={() => handleSend()}
            disabled={isPending || (!input.trim() && !imageBase64)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-center text-10 text-zinc-400">
          ContaFlow IA puede cometer errores. Verifica siempre con tu contador.
        </p>
      </div>
    </div>
  );
}
