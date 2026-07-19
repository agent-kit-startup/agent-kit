---
name: ux-message-flows
description: Conversational UX for chat agents (short messages, tone, confirmations, handoff).
version: 0.1.0
category: ux
---

# Skill: UX for Message Flows (Chatbots, WhatsApp, Telegram)

Best practices for creating conversational flows in chat agents.

## When to Use

- When creating chat agent prompts
- When designing service workflows
- When reviewing conversational flows
- When working with WhatsApp, Telegram, chatbots in general

## 1. Message Structure

- **Short messages:** Maximum 3 lines per block.
- **One action per message:** Don't mix multiple requests.
- **Clear confirmations:** "Got it! You want X, right?"
- **Break long messages:** Split into multiple short messages.

### Example

**Bad:**
> "Hello! Welcome to our service. To proceed, I need your ID, full name, date of birth and email. After that, I'll verify your account and inform you about available options."

**Good:**
> "Hello! I'll help you verify your account."
> "What's your ID number?"

## 2. Tone of Voice

- **Friendly, direct, no unnecessary jargon.**
- **Adapt to context:**
  - Formal for enterprise/B2B
  - Casual for consumer/B2C
- **Emojis in moderation:** Use for clarity, not decoration.

### Tone by Context

| Context | Tone | Example |
|---------|------|---------|
| Technical support | Professional, calm | "Got it. I'll fix this." |
| Customer service | Welcoming, quick | "No problem! I'll sort this out for you." |
| Sales | Enthusiastic, consultative | "Great choice! This product is perfect for..." |

## 3. Error Handling

- **Don't blame the user:** "Oops, something went wrong" > "You made an error".
- **Offer clear next step:** What the user should do now.
- **Gentle fallback:** "I didn't understand. Can you rephrase?"

### Fallback Examples

- "Hmm, I couldn't understand. Did you mean [option A] or [option B]?"
- "Sorry, I couldn't find that information. Can you try another way?"
- "I didn't understand. Want to speak with a human agent?"

## 4. Confirmations and Feedback

- **Always confirm important actions:** "Booking confirmed for March 15th."
- **Progress indicators:** "Processing...", "Almost there!", "Checking..."
- **Clear closure:** "Done! Your order has been registered."

### Confirmation Types

| Type | When to use | Example |
|------|-------------|---------|
| Quick confirmation | Simple actions | "Done!" |
| Confirmation with summary | Important actions | "Booking confirmed: Hotel X, Mar 15-17, 2 adults." |
| Confirmation with next step | Actions in flow | "Payment received! Now I'll send your ticket." |

## 5. Handoff Flows (Agent → Human)

When the agent needs to transfer to a human attendant:

1. **Notify the user:** "I'll transfer you to an agent."
2. **Pass summarized context to human:** ID, problem, what was already tried.
3. **Confirm when human takes over:** "All set! You're now speaking with [Name]."

### Handoff Example

> **Agent:** "This case needs a specialized agent. I'll transfer you now."
> **Agent:** "Passing context: customer wants to cancel booking #12345, already tried via app."
> **Agent:** "Hello! I'm Maria. I see you want to cancel the booking. I'll handle this."

## 6. Flow Patterns

### Options Menu

```
What do you need?
1️⃣ Make booking
2️⃣ Cancel booking
3️⃣ Speak with agent

(Type the number or write what you need)
```

### Sequential Data Collection

```
Agent: "What's your ID number?"
User: "123.456.789-00"
Agent: "Perfect! And your email?"
User: "john@email.com"
Agent: "Great! Data confirmed. Now I'll verify your account."
```

### Understanding Confirmation

```
User: "I want to change the date"
Agent: "Got it! You want to change your booking date. Is that right?"
User: "yes"
Agent: "Alright! What date do you want to change to?"
```

## 7. Common Errors to Avoid

| Error | Problem | Solution |
|-------|---------|----------|
| Messages too long | User doesn't read | Split into multiple short messages |
| Multiple questions at once | User gets confused | One question at a time |
| Technical jargon | User doesn't understand | Simple language |
| No next step | User gets lost | Always indicate what to do |
| Robotic tone | User disconnects | Friendly and natural tone |

## 8. Quick Checklist

- [ ] Messages with max 3 lines
- [ ] One action per message
- [ ] Clear next step
- [ ] Appropriate tone for context
- [ ] Gentle fallback for errors
- [ ] Confirmation of important actions
- [ ] Smooth handoff to human when needed
