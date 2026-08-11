interface DocumentInvalidationMessage {
  type: "document-invalidated";
  sourceInstanceId: string;
  storeName: string;
  id: string;
}

interface RecoveryInvalidationMessage {
  type: "recovery-invalidated";
  sourceInstanceId: string;
}

type InvalidationMessage = DocumentInvalidationMessage | RecoveryInvalidationMessage;
type DocumentListener = (
  message: Omit<DocumentInvalidationMessage, "type" | "sourceInstanceId">,
) => void;
type RecoveryListener = () => void;

const CHANNEL_NAME = "gas-pomodoro-document-content-v2";
const instanceId = crypto.randomUUID();
const documentListeners = new Set<DocumentListener>();
const recoveryListeners = new Set<RecoveryListener>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === "undefined") {
    channel = null;
    return channel;
  }
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener("message", (event: MessageEvent<InvalidationMessage>) => {
    const message = event.data;
    if (!message || message.sourceInstanceId === instanceId) return;
    if (message.type === "document-invalidated") {
      documentListeners.forEach((listener) => listener(message));
    } else if (message.type === "recovery-invalidated") {
      recoveryListeners.forEach((listener) => listener());
    }
  });
  return channel;
}

export function publishDocumentInvalidation(storeName: string, id: string): void {
  const message = { storeName, id };
  documentListeners.forEach((listener) => listener(message));
  getChannel()?.postMessage({
    ...message,
    type: "document-invalidated",
    sourceInstanceId: instanceId,
  } satisfies DocumentInvalidationMessage);
}

export function subscribeDocumentInvalidation(listener: DocumentListener): () => void {
  documentListeners.add(listener);
  getChannel();
  return () => documentListeners.delete(listener);
}

export function publishRecoveryInvalidation(): void {
  recoveryListeners.forEach((listener) => listener());
  getChannel()?.postMessage({
    type: "recovery-invalidated",
    sourceInstanceId: instanceId,
  } satisfies RecoveryInvalidationMessage);
}

export function subscribeRecoveryInvalidation(listener: RecoveryListener): () => void {
  recoveryListeners.add(listener);
  getChannel();
  return () => recoveryListeners.delete(listener);
}
