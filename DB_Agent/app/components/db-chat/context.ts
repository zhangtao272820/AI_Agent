import type { InjectionKey } from "vue";
import type { useDbChatPage } from "~/composables/useDbChatPage";

export type DbChatContext = ReturnType<typeof useDbChatPage>;
export const DbChatKey: InjectionKey<DbChatContext> = Symbol("dbChat");
