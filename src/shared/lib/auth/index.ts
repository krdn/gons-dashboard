// Auth.js v5 — Google OAuth + Drizzle adapter + allowlist.
//
// 정책:
//  - External Test 모드 (refresh token 7일 만료) — D3 결정대로 만료 감지 → 메일 알림 + 배너
//  - allowlist에 있는 이메일만 로그인 허용
//  - Gmail scope: gmail.modify + gmail.readonly + openid + userinfo.email
//    (modify 가 readonly 의 superset 이라 modify 단독으로도 list/get 가능하지만,
//     독자가 "왜 readonly 가 없지?" 자문하지 않도록 둘 다 명시)
import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
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
          // gmail.modify 는 messages.modify (라벨 추가/제거) 호출에 필수.
          //   - readonly 만 부여 시 modify API 호출이 403 ("Gmail 권한이 부족합니다").
          //   - "읽음"/"보관" 액션이 동작하려면 modify 가 grant 되어야 함.
          // gmail.metadata 는 의도적으로 제외 — readonly 와 함께 부여하면 metadata 가
          // 우선 적용되어 messages.list?q= search 쿼리가 차단됨 ("Metadata scope does
          // not support 'q' parameter").
          //
          // include_granted_scopes 를 의도적으로 *설정하지 않음*: 켜면 같은 OAuth client
          // 로 과거에 grant 된 admin-controlled scope (예: cloud-identity.devices) 가
          // 자동 포함되어 invalid_scope 400 으로 consent 거부됨. prompt=consent +
          // 명시적 scope 목록만으로 충분.
          scope: [
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.modify",
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
  events: {
    // 재인증 성공 시 oauth_state를 active로 복구. adapter가 accounts row를
    // upsert한 다음에 실행되므로 토큰은 이미 저장된 상태. last_history_id는
    // 건드리지 않음 — null이면 다음 폴링이 full sync로 떨어지는 게 의도된 동작.
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.id) {
        await db
          .update(users)
          .set({ oauthState: "active", tokenExpiredAt: null })
          .where(eq(users.id, user.id));
      }
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
