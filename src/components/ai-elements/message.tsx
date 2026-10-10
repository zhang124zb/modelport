// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Modified for ModelPort: retained response renderer and safe highlighter; see THIRD_PARTY_NOTICES.md.
"use client";

import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@/lib/code-highlighter";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;
const streamdownPlugins = { cjk, code, math, mermaid };

export const MessageResponse = memo(({ className, ...props }: MessageResponseProps) => (
  <Streamdown
    className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
    plugins={streamdownPlugins}
    {...props}
  />
));
MessageResponse.displayName = "MessageResponse";
