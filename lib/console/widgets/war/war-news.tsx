"use client";
// lib/console/widgets/war/war-news.tsx
// STUB from the war-sources foundation commit (M1): the console uses the generic signal
// card and expanded view until this file exports its own. The agent that owns the
// "war-news" source replaces it. Do not import lib/console/widgets/signals.tsx here.
import type { ComponentType } from "react";
import type { WidgetBodyProps, WidgetDetailProps } from "@/lib/console/registry";

export const Card: ComponentType<WidgetBodyProps> | undefined = undefined;
export const Detail: ComponentType<WidgetDetailProps> | undefined = undefined;
