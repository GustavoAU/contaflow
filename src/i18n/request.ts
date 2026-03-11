// src/i18n/request.ts
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = cookieStore.get("locale")?.value ?? "es";

  const validLocales = ["es", "en"];
  const safeLocale = validLocales.includes(locale) ? locale : "es";

  return {
    locale: safeLocale,
    messages: (await import(`../../messages/${safeLocale}.json`)).default,
  };
});
