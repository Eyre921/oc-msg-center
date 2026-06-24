import type { Config } from "../config.ts";
import type { Store } from "../db/store.ts";
import type { User } from "../types.ts";

/**
 * Reverse command router: interprets slash commands a user sends *to* the bot
 * (QQ / WeChat).
 *
 * By design these are READ-ONLY / informational. Subscriptions and group
 * membership are assigned by an administrator (web UI / API), not self-served
 * from chat. Anything that is not a command is treated as a reverse message
 * and republished to the user's inbox topic (see inbound.ts).
 */
export class Commands {
  constructor(
    private readonly cfg: Config,
    private readonly store: Store,
  ) {}

  isCommand(text: string): boolean {
    return text.trim().startsWith("/");
  }

  async handle(user: User, _channel: string, text: string): Promise<string> {
    const cmd = (text.trim().split(/\s+/)[0] || "").toLowerCase();
    switch (cmd) {
      case "/help":
        return this.help();
      case "/whoami":
      case "/id":
        return this.whoami(user);
      case "/subs":
      case "/topics":
        return this.listSubs(user);
      case "/groups":
        return this.listGroups(user);
      default:
        return `未知指令 ${cmd}。发送 /help 查看可用指令。`;
    }
  }

  private help(): string {
    return [
      "📖 消息中心指令（订阅由管理员统一分配）：",
      "/whoami — 查看我的账户与绑定信息",
      "/subs — 查看管理员为我分配的订阅",
      "/groups — 查看我所在的分组",
      "/help — 显示本帮助",
      "",
      "直接发送文字或文件即可回传到消息中心（反向消息）。",
    ].join("\n");
  }

  private whoami(user: User): string {
    const ids = this.store.listIdentitiesForUser(user.id);
    const bindings = ids.map((i) => `• ${i.channel}: ${i.externalId}`).join("\n") || "（无）";
    return [`👤 ${user.username}`, `角色：${user.role}`, `ID：${user.id}`, "已绑定渠道：", bindings].join("\n");
  }

  private listSubs(user: User): string {
    const subs = this.store.listSubscriptionsForUser(user.id);
    if (subs.length === 0) return "管理员还没有为你分配任何订阅。";
    return "📋 我的订阅：\n" + subs.map((s) => `• ${s.topic} (优先级≥${s.minPriority})`).join("\n");
  }

  private listGroups(user: User): string {
    const groups = this.store.listGroupsForUser(user.id);
    if (groups.length === 0) return "你还不在任何分组中。";
    return "👥 我所在的分组：\n" + groups.map((g) => `• ${g.name}`).join("\n");
  }
}
