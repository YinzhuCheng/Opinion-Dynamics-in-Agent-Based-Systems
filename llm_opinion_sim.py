import torch
import torch.nn as nn
import torch.nn.functional as F
PAD_IDX = 0
MAX_LEN = 6
def build_vocab(samples):
    words = {w for text, *_ in samples for w in text.split()}
    vocab = {"<pad>": PAD_IDX}
    for word in sorted(words):
        if word not in vocab:
            vocab[word] = len(vocab)
    return vocab

def encode(text, vocab):
    return torch.tensor([vocab[word] for word in text.split()], dtype=torch.long)

def pad_to_max(tokens):
    if tokens.numel() > MAX_LEN:
        raise ValueError("Text longer than MAX_LEN")
    return F.pad(tokens, (0, MAX_LEN - tokens.numel()), value=PAD_IDX)


class TinyLLM(nn.Module):
    def __init__(self, vocab_size, opinion_dim=3, d_model=32, nhead=4, layers=2):
        super().__init__()
        self.emb = nn.Embedding(vocab_size, d_model)
        layer = nn.TransformerEncoderLayer(d_model, nhead, 64, batch_first=True)
        self.encoder = nn.TransformerEncoder(layer, layers)
        self.op_proj = nn.Linear(opinion_dim, d_model)
        self.head = nn.Linear(d_model, opinion_dim)

    def forward(self, tokens, opinion):
        mask = tokens.eq(PAD_IDX)
        x = self.emb(tokens)
        h = self.encoder(x, src_key_padding_mask=mask)
        h = h.masked_fill(mask.unsqueeze(-1), 0.0)
        lengths = mask.logical_not().sum(dim=1, keepdim=True).clamp(min=1)
        pooled = h.sum(dim=1) / lengths
        context = pooled + self.op_proj(opinion)
        return torch.tanh(self.head(context))


def main():
    train_samples = [
        ("climate change urgent action", [0.1, -0.2, 0.0], [0.8, -0.3, 0.2]),
        ("renewable energy breakthrough", [0.3, -0.1, 0.2], [0.9, -0.1, 0.5]),
        ("tax cuts boost economy", [-0.2, 0.2, 0.1], [-0.4, 0.8, 0.2]),
        ("automation job loss fears", [-0.1, 0.3, 0.4], [-0.2, 0.1, -0.6]),
        ("ai ethics regulation", [0.0, -0.2, 0.5], [0.2, -0.4, 0.3]),
        ("economic downturn recession", [0.2, 0.4, -0.1], [0.3, -0.6, -0.3]),
        ("tech innovation boom", [0.1, -0.3, 0.2], [0.2, -0.2, 0.8]),
        ("green jobs program", [0.4, -0.1, 0.0], [0.9, 0.3, 0.1]),
    ]
    vocab = build_vocab(train_samples)
    inputs = torch.stack(
        [pad_to_max(encode(text, vocab)) for text, _, _ in train_samples]
    )
    start = torch.tensor([s for _, s, _ in train_samples], dtype=torch.float32)
    target = torch.tensor([t for _, _, t in train_samples], dtype=torch.float32)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = TinyLLM(len(vocab), opinion_dim=start.size(1)).to(device)
    inputs = inputs.to(device)
    start = start.to(device)
    target = target.to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-2)
    loss_fn = nn.MSELoss()
    for epoch in range(400):
        opt.zero_grad()
        pred = model(inputs, start)
        loss = loss_fn(pred, target)
        loss.backward()
        opt.step()
        if epoch % 100 == 0:
            print(f"epoch {epoch:03d} loss {loss.item():.4f}")
    model.eval()
    agents = {
        "Ava": torch.tensor([0.2, -0.1, 0.1], dtype=torch.float32),
        "Ben": torch.tensor([-0.3, 0.4, -0.2], dtype=torch.float32),
        "Chen": torch.tensor([0.5, -0.2, 0.6], dtype=torch.float32),
    }
    timeline = [
        "climate change urgent action",
        "green jobs program",
        "tax cuts boost economy",
        "automation job loss fears",
        "tech innovation boom",
    ]
    with torch.no_grad():
        for step, event in enumerate(timeline, 1):
            tokens = pad_to_max(encode(event, vocab)).unsqueeze(0).to(device)
            print(f"\nStep {step}: {event}")
            for name, opinion in agents.items():
                update = model(tokens, opinion.unsqueeze(0).to(device)).squeeze(0).cpu()
                agents[name] = 0.7 * opinion + 0.3 * update
                print(f"  {name}: {agents[name].tolist()}")

if __name__ == "__main__":
    main()
