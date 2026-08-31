class PlanilhaATException(Exception):
    """Exceção base do sistema"""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

class NotFoundException(PlanilhaATException):
    def __init__(self, message: str = "Recurso não encontrado"):
        super().__init__(message=message, status_code=404)

class ValidationException(PlanilhaATException):
    def __init__(self, message: str = "Falha de validação de dados"):
        super().__init__(message=message, status_code=422)

class RuleResolutionException(PlanilhaATException):
    def __init__(self, message: str = "Regra de alíquota não encontrada"):
        super().__init__(message=message, status_code=422)

class TemplateIntegrityException(PlanilhaATException):
    def __init__(self, message: str = "Violação de integridade ou fórmula de template Excel"):
        super().__init__(message=message, status_code=400)
