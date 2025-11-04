import { useState } from "react";
import logo from "@/assets/Logo laranja.png";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const loginSchema = z.object({
  username: z.string().min(1, "Usuário é obrigatório"),
  password: z.string().min(1, "Senha é obrigatória"),
});

type LoginForm = z.infer<typeof loginSchema>;

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    
    try {
      await apiRequest("POST", "/api/auth/login", data);
      
      toast({
        title: "Login realizado com sucesso",
        description: "Bem-vindo ao sistema!",
      });
      
      onLoginSuccess();
    } catch (error: any) {
      toast({
        title: "Erro no login",
        description: error.message || "Usuário ou senha incorretos",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center">
          <img
            src={logo}
            alt="Seguro IA"
            className="h-12 w-auto object-contain"
            data-testid="img-logo-login"
          />
        </div>
        <Card>
          <CardHeader className="space-y-1">
            <CardDescription className="text-center">
              Faça login para acessar o sistema
            </CardDescription>
          </CardHeader>
          <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Usuário</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Digite seu usuário"
                        autoComplete="username"
                        disabled={isLoading}
                        data-testid="input-username"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="Digite sua senha"
                        autoComplete="current-password"
                        disabled={isLoading}
                        data-testid="input-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          </Form>
        </CardContent>
        </Card>
      </div>
    </div>
  );
}
