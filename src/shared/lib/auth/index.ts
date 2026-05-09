// Auth.js v5 — Google OAuth + Drizzle adapter + allowlist.
//
// 정책:
//  - External Test 모드 (refresh token 7일 만료) — D3 결정대로 만료 감지 → 메일 알림 + 배너
//  - allowlist에 있는 이메일만 로그인 허용
//  - Gmail scope: gmail.readonly + gmail.metadata + openid + userinfo.email
import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/shared/lib/db/client";
import { env } from "@/shared/config/env";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/shared/lib/db/schema";

const allowlist = new Set(
  env.ALLOWLIST_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  trustHost: true,
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // gmail.readonly만 — gmail.metadata와 함께 부여하면 metadata가 우선 적용되어
          // messages.list?q= search 쿼리가 차단됨 ("Metadata scope does not support 'q' parameter").
          // readonly 단독 부여 시 메타데이터 + search 모두 가능.
          scope: [
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/gmail.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent", // refresh_token 발급 보장
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      if (!email || !allowlist.has(email)) {
        // 비-allowlist 이메일 차단
        return false;
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
