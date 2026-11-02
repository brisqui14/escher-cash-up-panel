using Microsoft.AspNetCore.Diagnostics;

namespace CashUp.React.Api;

public sealed class BadRequestHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not BadHttpRequestException badRequest)
        {
            return false;
        }
        await Results.Problem(
            statusCode: badRequest.StatusCode,
            title: "Invalid request",
            detail: "The request body must match the documented JSON contract.")
            .ExecuteAsync(context);
        return true;
    }
}
