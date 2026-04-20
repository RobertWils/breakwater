import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

// Storm Cyan palette — single source of truth for both email templates.
export const colors = {
  bodyBg: "#0C1C3A",
  containerBg: "#17306B",
  text: "#F1F5F9",
  ctaBg: "#14B8A6",
  ctaText: "#0C1C3A",
  muted: "#A5B4CD",
} as const;

type EmailLayoutProps = {
  preview: string;
  heading: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  children?: ReactNode;
};

export function EmailLayout({
  preview,
  heading,
  bodyText,
  ctaLabel,
  ctaUrl,
  children,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colors.bodyBg,
          color: colors.text,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          margin: 0,
          padding: "40px 0",
        }}
      >
        <Container
          style={{
            backgroundColor: colors.containerBg,
            borderRadius: "8px",
            margin: "0 auto",
            maxWidth: "480px",
            padding: "32px",
          }}
        >
          <Heading
            as="h1"
            style={{
              color: colors.text,
              fontSize: "24px",
              margin: "0 0 16px 0",
            }}
          >
            {heading}
          </Heading>
          <Text
            style={{
              color: colors.text,
              fontSize: "16px",
              lineHeight: "24px",
              margin: "0 0 24px 0",
            }}
          >
            {bodyText}
          </Text>
          <Section style={{ margin: "0 0 24px 0" }}>
            <Button
              href={ctaUrl}
              style={{
                backgroundColor: colors.ctaBg,
                borderRadius: "6px",
                color: colors.ctaText,
                display: "inline-block",
                fontSize: "16px",
                fontWeight: 600,
                padding: "12px 24px",
                textDecoration: "none",
              }}
            >
              {ctaLabel}
            </Button>
          </Section>
          <Text
            style={{
              color: colors.muted,
              fontSize: "13px",
              lineHeight: "20px",
              margin: 0,
            }}
          >
            If you didn&apos;t request this email, you can safely ignore it.
          </Text>
          {children}
        </Container>
      </Body>
    </Html>
  );
}
