# backend/tests/smtp_server.py
# Purpose: a REAL SMTP server running inside the test (aiosmtpd), so the email code is checked against the
# actual protocol (connect, STARTTLS / implicit TLS, login, message) instead of against mocks.

import datetime
import ipaddress
import socket
import ssl
from contextlib import contextmanager
from pathlib import Path

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import AuthResult, LoginPassword
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

USERNAME, PASSWORD = "mailer", "s3cret"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_certificate(directory: Path) -> tuple[Path, Path]:
    """A self-signed certificate for localhost / 127.0.0.1. Returns (cert file, key file)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    cert_file, key_file = directory / "cert.pem", directory / "key.pem"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()
        )
    )
    return cert_file, key_file


class Inbox:
    """Collects what the server received, and how each connection behaved."""

    def __init__(self):
        self.messages = []  # (envelope, parsed message)
        self.sessions = set()
        self.logins = []

    async def handle_DATA(self, server, session, envelope):
        from email import message_from_bytes, policy

        self.sessions.add(id(session))
        self.messages.append(message_from_bytes(envelope.original_content, policy=policy.default))
        return "250 OK"

    def authenticate(self, server, session, envelope, mechanism, auth_data):
        if isinstance(auth_data, LoginPassword) and (auth_data.login, auth_data.password) == (USERNAME.encode(), PASSWORD.encode()):
            self.logins.append(auth_data.login.decode())
            return AuthResult(success=True)
        return AuthResult(success=False, handled=False)


@contextmanager
def smtp_server(tmp_path, mode="plain", auth=False):
    """mode: "plain" (no TLS), "starttls" (TLS offered and required), "ssl" (TLS from the first byte).

    Yields (port, inbox, cert_file).
    """
    inbox = Inbox()
    cert_file, key_file = make_certificate(tmp_path)
    context = None
    if mode != "plain":
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert_file, key_file)
    port = free_port()
    kwargs = dict(
        hostname="127.0.0.1",
        port=port,
        authenticator=inbox.authenticate if auth else None,
        auth_required=auth,
        auth_require_tls=(mode == "starttls"),  # implicit-TLS connections are encrypted from the start; aiosmtpd does not count them for this check
    )
    if mode == "starttls":
        kwargs.update(tls_context=context, require_starttls=True)
    elif mode == "ssl":
        kwargs.update(ssl_context=context)
    controller = Controller(inbox, **kwargs)
    controller.start()
    try:
        yield port, inbox, cert_file
    finally:
        controller.stop()
