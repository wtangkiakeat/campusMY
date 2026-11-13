from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError
from starlette.responses import Response
from .config import Settings, get_settings
from .db import Base, make_engine
from .auth import TokenVerifier
from . import models, public, accounts, community, admin


class BodyTooLarge(HTTPException):
    def __init__(self):
        super().__init__(413, "Request body too large")


class BodyLimitMiddleware:
    def __init__(self, app, maximum):
        self.app=app;self.maximum=maximum

    async def __call__(self, scope, receive, send):
        if scope['type']!='http':
            await self.app(scope,receive,send);return
        received=0
        async def limited_receive():
            nonlocal received
            message=await receive()
            if message['type']=='http.request':
                received+=len(message.get('body',b''))
                if received>self.maximum: raise BodyTooLarge()
            return message
        try:
            await self.app(scope,limited_receive,send)
        except BodyTooLarge:
            await JSONResponse({'detail':'Request body too large'},status_code=413)(scope,receive,send)


def create_app(settings: Settings | None=None):
    settings=settings or get_settings()
    engine=make_engine(settings)
    if settings.create_tables:
        Base.metadata.create_all(engine)
    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()
    app=FastAPI(title='CampusMY API',version='0.1.0',lifespan=lifespan,
        docs_url='/docs' if settings.environment!='production' else None,
        redoc_url=None)
    app.state.settings=settings
    app.state.engine=engine
    app.state.session_factory=sessionmaker(engine,expire_on_commit=False)
    app.state.token_verifier=TokenVerifier(settings)
    app.add_middleware(BodyLimitMiddleware,maximum=settings.max_body_bytes)
    app.add_middleware(CORSMiddleware,allow_origins=[o.strip() for o in settings.cors_origins.split(',') if o.strip()],
        allow_credentials=False,allow_methods=['GET','POST','PATCH','PUT','DELETE','OPTIONS'],allow_headers=['Authorization','Content-Type'])

    @app.middleware('http')
    async def security_headers(request:Request,call_next):
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['X-Frame-Options']='DENY'
        response.headers['Cache-Control']='no-store'
        response.headers['X-Robots-Tag']='noindex'
        if settings.environment=='production': response.headers['Strict-Transport-Security']='max-age=31536000; includeSubDomains'
        return response

    @app.exception_handler(IntegrityError)
    async def integrity_error(request,error):
        return JSONResponse({'detail':'The requested change conflicts with existing data'},status_code=409)

    @app.get('/health/live',tags=['health'])
    def live(): return {'status':'ok'}

    @app.get('/health/ready',tags=['health'])
    def ready():
        try:
            with engine.connect() as connection:
                connection.execute(text('SELECT 1'))
                connection.execute(text('SELECT COUNT(*) FROM '+ ('"'+settings.database_schema+'".' if settings.database_schema else '') +'courses'))
        except Exception:
            return JSONResponse({'status':'not-ready','message':'Run database migrations and seed import'},status_code=503)
        return {'status':'ready','authentication_configured':bool(settings.supabase_url),
                'email_configured':bool(settings.smtp_host and settings.smtp_from and len(settings.otp_secret)>=32)}

    for router in (public.router,accounts.router,community.router,admin.router): app.include_router(router)
    return app


app=create_app()
