"""Roteamento por fornecedor, restrito à empresa e à aquisição interestadual."""
import re


def _digits(value):
    return re.sub(r"\D", "", value or "")


def usage_decision_key(note):
    key = _digits(note.chave_acesso)
    if len(key) == 44:
        return key
    return ":".join([_digits(note.cnpj_emitente), str(note.serie or ""), str(note.numero_nota), note.data_emissao.isoformat()[:10]])


def supplier_usage_rule(note, empresa):
    supplier = _digits(note.cnpj_emitente)
    client = _digits(empresa.cnpj)
    uf = (note.uf_emitente or "").strip().upper()
    client_uf = (empresa.uf or "").strip().upper()
    if (len(supplier) != 14 or supplier == client or _digits(note.cnpj_destinatario) != client
            or str(note.raw_metadata.get("ind_emit")) == "0" or not uf or not client_uf or uf == client_uf):
        return None
    return next((item for item in (getattr(empresa, "fornecedores_uso_consumo", None) or [])
                 if _digits(item.get("cnpj")) == supplier), None)


def supplier_usage_mode(note, empresa, decisions=None):
    rule = supplier_usage_rule(note, empresa)
    if rule and rule.get("modo") == "automatico":
        return "automatico"
    if rule and rule.get("modo") == "confirmacao" and (decisions or {}).get(usage_decision_key(note)) is True:
        return "confirmado"
    return None


def supplier_usage_pending(notes, empresa, decisions=None):
    pending = []
    for _, note in notes:
        rule = supplier_usage_rule(note, empresa)
        if not rule or rule.get("modo") != "confirmacao" or not note.itens:
            continue
        key = usage_decision_key(note)
        if isinstance((decisions or {}).get(key), bool):
            continue
        pending.append({
            "key": key, "chaveAcesso": note.chave_acesso, "numeroNota": note.numero_nota,
            "serie": note.serie or "", "cnpj": note.cnpj_emitente,
            "fornecedor": rule.get("nome") or note.raw_metadata.get("emit_nome") or "",
            "quantidadeItens": len(note.itens), "valorTotal": note.v_total_nota,
        })
    return pending
